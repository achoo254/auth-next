import type { Express } from "express";
import type { Db } from "mongodb";
import { createAuditDeliveryResolver } from "../audit/audit-delivery.js";
import { AuditDispatcher } from "../audit/audit-dispatcher.js";
import { allTenantsAuditQueue } from "../audit/audit-queue.js";
import type { Env } from "../config/env.js";
import { auditDeliveryConfig } from "../config/integrations-env.js";
import { nativeRedirectSchemes, securityHeaders } from "../http/security.js";
import {
	type TenantLookup,
	createDispatcher,
} from "../http/tenant-dispatcher.js";
import type { Logger } from "../logger.js";
import type { SigningJwks } from "../oidc/jwks.js";
import { installEnrollmentFrom } from "./install-enrollment-env.js";
import { createInternalApi } from "./internal-api.js";
import { parseInternalCredentials } from "./internal-auth.js";
import { SYSTEM_RESOLVER } from "./ownership-records.js";
import { RuntimeRegistry } from "./runtime-registry.js";
import { parseKeyring } from "./secret-keyring.js";
import { type TenancyOverrides, createTenancy } from "./tenancy.js";
import { createTenantMaintenance } from "./tenant-maintenance.js";
import { TenantRegistry } from "./tenant-registry.js";
import {
	type TenantRuntime,
	buildPrimaryRuntime,
	buildTenantRuntime,
	tenantFromDocument,
	tenantSigningKeys,
} from "./tenant-runtime.js";
import { TenantSecrets } from "./tenant-secrets.js";

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
	overrides: TenancyOverrides = {},
): Promise<Serving> {
	const registry = new TenantRegistry(db);
	const keyring = parseKeyring(env.TENANT_SECRETS_KEY);
	const secrets = keyring && new TenantSecrets(db, keyring);
	const appClientSecretKey = env.APP_CLIENT_SECRET_KEY;
	// The registry is built after the tenancy that refers to it.
	const built: { runtimes?: RuntimeRegistry } = {};
	const tenancy =
		secrets && appClientSecretKey
			? await createTenancy(
					env,
					db,
					logger,
					{ registry, secrets, signingJwks: jwks },
					(id) => built.runtimes?.dispose(id),
					overrides,
				)
			: undefined;
	const enrollment = await installEnrollmentFrom(env, logger);
	const primary = buildPrimaryRuntime(
		env,
		db,
		jwks,
		logger,
		tenancy,
		enrollment?.router,
	);
	const primaryHosts = [
		new URL(primary.tenant.issuer).host,
		...env.ALLOWED_HOSTS,
	];
	const runtimes =
		secrets && appClientSecretKey
			? new RuntimeRegistry({
					primary,
					primaryHosts,
					primaryDomain: primary.tenant.domain,
					registry,
					maxActive: env.TENANT_MAX_ACTIVE,
					logger,
					build: (document) =>
						buildTenantRuntime(
							{ env, db, logger, secrets, appClientSecretKey, tenancy },
							document,
						),
				})
			: undefined;
	built.runtimes = runtimes;
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
		headers: securityHeaders(primary.tenant.issuer, nativeRedirectSchemes(env)),
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
					db,
					registry,
					secrets,
					primary,
					primaryHosts,
					publicOrigin: `http://127.0.0.1:${env.PORT}`,
					scribeTenants: env.SCRIBE_TENANTS,
					logger,
				})
			: undefined;

	const maintenance =
		runtimes && (env.SERVICE_IPV4 || env.SELF_HOSTED_CLAIMS)
			? createTenantMaintenance({
					db,
					registry,
					runtimes,
					resolver: SYSTEM_RESOLVER,
					serviceIp: env.SERVICE_IPV4,
					logger,
				})
			: undefined;
	return {
		primary,
		app,
		internalApp,
		auditDispatcher,
		start() {
			auditDispatcher.start();
			secrets
				?.resealStale()
				.then((count) => {
					if (count > 0) logger.info({ count }, "Tenant secrets re-sealed");
				})
				.catch((error: unknown) => {
					logger.error({ err: error }, "Re-sealing tenant secrets failed");
				});
			maintenance?.start();
			enrollment?.start();
		},
		async stop() {
			maintenance?.stop();
			enrollment?.stop();
			await auditDispatcher.stop();
		},
	};
}
