import type { Express } from "express";
import type { Db } from "mongodb";
import { createAuditDeliveryResolver } from "../audit/audit-delivery.js";
import { AuditDispatcher } from "../audit/audit-dispatcher.js";
import { allTenantsAuditQueue } from "../audit/audit-queue.js";
import type { Env } from "../config/env.js";
import { auditDeliveryConfig } from "../config/integrations-env.js";
import { securityHeaders } from "../http/security.js";
import {
	type TenantLookup,
	createDispatcher,
} from "../http/tenant-dispatcher.js";
import type { Logger } from "../logger.js";
import type { SigningJwks } from "../oidc/jwks.js";
import { createInternalApi } from "./internal-api.js";
import { parseInternalCredentials } from "./internal-auth.js";
import { SYSTEM_RESOLVER, checkAllOwnership } from "./ownership-check.js";
import { RuntimeRegistry } from "./runtime-registry.js";
import { parseKeyring } from "./secret-keyring.js";
import { SERVING_STATUSES, TenantRegistry } from "./tenant-registry.js";
import {
	type TenantRuntime,
	buildPrimaryRuntime,
	buildTenantRuntime,
	tenantFromDocument,
	tenantSigningKeys,
} from "./tenant-runtime.js";
import { TenantSecrets } from "./tenant-secrets.js";

const OWNERSHIP_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Everything the server process runs, assembled from the environment. */
export interface Serving {
	readonly primary: TenantRuntime;
	/** The public app: every tenant, chosen by Host. */
	readonly app: Express;
	/** The loopback-only internal API, when credentials are configured. */
	readonly internalApp?: Express;
	readonly auditDispatcher: AuditDispatcher;
	/** Starts background jobs (audit delivery, ownership checks). */
	start(): void;
	stop(): Promise<void>;
}

/**
 * The primary tenant always; registry tenants too once TENANT_SECRETS_KEY
 * and APP_CLIENT_SECRET_KEY are set (without them the IdP behaves as a
 * single-tenant server). One audit dispatcher delivers every tenant's
 * events; ownership is re-checked when SERVICE_IPV4 is known.
 */
export async function createServing(
	env: Env,
	db: Db,
	jwks: SigningJwks,
	logger: Logger,
): Promise<Serving> {
	const primary = buildPrimaryRuntime(env, db, jwks, logger);
	const primaryHosts = [
		new URL(primary.tenant.issuer).host,
		...env.ALLOWED_HOSTS,
	];
	const registry = new TenantRegistry(db);
	const keyring = parseKeyring(env.TENANT_SECRETS_KEY);
	const secrets = keyring && new TenantSecrets(db, keyring);
	const appClientSecretKey = env.APP_CLIENT_SECRET_KEY;
	const runtimes =
		secrets && appClientSecretKey
			? new RuntimeRegistry({
					primary,
					primaryHosts,
					registry,
					maxActive: env.TENANT_MAX_ACTIVE,
					logger,
					build: (document) =>
						buildTenantRuntime(
							{ env, db, logger, secrets, appClientSecretKey },
							document,
						),
				})
			: undefined;
	const hosts = new Set(primaryHosts.map((host) => host.toLowerCase()));
	const lookup = async (host: string | undefined): Promise<TenantLookup> => {
		if (runtimes) return runtimes.lookup(host);
		return host && hosts.has(host.toLowerCase())
			? { kind: "found", runtime: primary }
			: { kind: "unknown" };
	};
	const app = createDispatcher({
		trustProxy: env.TRUST_PROXY,
		lookup,
		logger,
		headers: securityHeaders(primary.tenant.issuer),
	});

	const delivery = auditDeliveryConfig(env);
	const auditDispatcher = new AuditDispatcher({
		outbox: allTenantsAuditQueue(db),
		deliveryFor:
			delivery &&
			createAuditDeliveryResolver({
				primary: { config: delivery, issuer: primary.tenant.issuer, jwks },
				tenantKeys: async (tenantId) => {
					const document = await registry.findById(tenantId);
					if (!secrets || !document) return undefined;
					if (!SERVING_STATUSES.includes(document.status)) return undefined;
					return {
						tenant: tenantFromDocument(document),
						jwks: await tenantSigningKeys(secrets, tenantId),
					};
				},
			}),
		logger,
	});

	const credentials = parseInternalCredentials(env.INTERNAL_API_CREDENTIALS);
	const internalApp =
		credentials.size > 0
			? createInternalApi({
					credentials,
					registry,
					secrets,
					primary,
					primaryHosts,
					publicOrigin: `http://127.0.0.1:${env.PORT}`,
					logger,
				})
			: undefined;

	let ownershipTimer: NodeJS.Timeout | undefined;
	const serviceIp = env.SERVICE_IPV4;
	const checkOwnership = (): void => {
		if (!runtimes || !serviceIp) return;
		checkAllOwnership({
			registry,
			resolver: SYSTEM_RESOLVER,
			serviceIp,
			logger,
			onSuspended: (tenant) => runtimes.dispose(tenant._id),
		}).catch((error: unknown) => {
			logger.warn({ err: error }, "Tenant ownership check failed");
		});
	};
	return {
		primary,
		app,
		internalApp,
		auditDispatcher,
		start() {
			auditDispatcher.start();
			if (runtimes && serviceIp) {
				ownershipTimer = setInterval(
					checkOwnership,
					OWNERSHIP_CHECK_INTERVAL_MS,
				);
				ownershipTimer.unref();
			}
		},
		async stop() {
			clearInterval(ownershipTimer);
			await auditDispatcher.stop();
		},
	};
}
