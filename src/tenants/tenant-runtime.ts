import type { Express } from "express";
import type { Db } from "mongodb";
import { AccountRepository } from "../accounts/account-repository.js";
import { createUpstreamsFrom } from "../accounts/upstream-client.js";
import { createTenantApp } from "../app.js";
import { AuditOutbox } from "../audit/audit-outbox.js";
import type { Env } from "../config/env.js";
import type { OAuthAppCredentials } from "../config/integrations-env.js";
import type { Logger } from "../logger.js";
import {
	type SigningJwks,
	generateSigningJwk,
	parseSigningJwks,
} from "../oidc/jwks.js";
import { createProvider } from "../oidc/provider.js";
import { type AppServices, createServices } from "../services.js";
import { createTelegramBot } from "../telegram/bot-client.js";
import { derivedClientSecrets } from "./app-client-secrets.js";
import { envClientSecrets, envTenant } from "./env-tenant.js";
import type { TenantDocument } from "./tenant-registry.js";
import { webAppsFor } from "./tenant-resources.js";
import type { TenantSecrets } from "./tenant-secrets.js";
import type { Tenant } from "./tenant.js";

/** Everything one tenant serves with, built once and kept while it is active. */
export interface TenantRuntime {
	readonly tenant: Tenant;
	readonly services: AppServices;
	/** The tenant's own Express app (pages, provider); mounted per request. */
	readonly app: Express;
	readonly jwks: SigningJwks;
}

/** The primary tenant (from the environment), built once and pinned. */
export function buildPrimaryRuntime(
	env: Env,
	db: Db,
	jwks: SigningJwks,
	logger: Logger,
): TenantRuntime {
	const tenant = envTenant(env);
	const accounts = new AccountRepository(
		db,
		tenant,
		new AuditOutbox(db, tenant, logger),
	);
	const provider = createProvider({
		tenant,
		db,
		jwks,
		cookieKeys: env.COOKIE_KEYS,
		clientSecrets: envClientSecrets(env),
		accountStore: accounts,
		logger,
	});
	const services = createServices({
		env,
		tenant,
		db,
		provider,
		logger,
		accounts,
	});
	return { tenant, services, app: createTenantApp({ services, env }), jwks };
}

/** A registry tenant as the rest of the IdP sees it. */
export function tenantFromDocument(document: TenantDocument): Tenant {
	return {
		id: document._id,
		domain: document.domain,
		displayName: document.displayName,
		issuer: `https://auth.${document.domain}`,
		status: document.status,
		webApps: webAppsFor(document.domain),
	};
}

export interface RuntimeFactoryDependencies {
	readonly env: Env;
	readonly db: Db;
	readonly logger: Logger;
	readonly secrets: TenantSecrets;
	/** `APP_CLIENT_SECRET_KEY`: derives the tenant's Localman/Tunelo secrets. */
	readonly appClientSecretKey: string;
}

function parseCredentials(
	value: string | undefined,
): OAuthAppCredentials | undefined {
	if (!value) return undefined;
	const parsed: unknown = JSON.parse(value);
	if (typeof parsed !== "object" || parsed === null) return undefined;
	const clientId: unknown = Reflect.get(parsed, "clientId");
	const clientSecret: unknown = Reflect.get(parsed, "clientSecret");
	return typeof clientId === "string" && typeof clientSecret === "string"
		? { clientId, clientSecret }
		: undefined;
}

/**
 * The tenant's signing keys: generated on first use (one ES256 key, one
 * RS256 key for ID tokens of RS256 clients) and stored sealed, so every
 * later build, the audit signer and the internal JWKS read the same keys.
 */
export async function tenantSigningKeys(
	secrets: TenantSecrets,
	tenantId: string,
): Promise<SigningJwks> {
	const existing = await secrets.get(tenantId, "signing-keys");
	if (existing) return parseSigningJwks(JSON.parse(existing));
	const fresh: SigningJwks = {
		keys: [await generateSigningJwk(), await generateSigningJwk("RS256")],
	};
	const stored = await secrets.putIfAbsent(
		tenantId,
		"signing-keys",
		JSON.stringify(fresh),
	);
	return parseSigningJwks(JSON.parse(stored));
}

/**
 * Builds the runtime of a registry tenant: its provider (own issuer, keys,
 * client secrets), stores bound to it, and only the integrations its owner
 * configured (Google, GitHub, Telegram); never the primary tenant's.
 */
export async function buildTenantRuntime(
	deps: RuntimeFactoryDependencies,
	document: TenantDocument,
): Promise<TenantRuntime> {
	const { env, db, logger, secrets } = deps;
	const tenant = tenantFromDocument(document);
	const jwks = await tenantSigningKeys(secrets, tenant.id);
	const accounts = new AccountRepository(
		db,
		tenant,
		new AuditOutbox(db, tenant, logger),
	);
	const provider = createProvider({
		tenant,
		db,
		jwks,
		cookieKeys: env.COOKIE_KEYS,
		clientSecrets: derivedClientSecrets(deps.appClientSecretKey, tenant.id),
		accountStore: accounts,
		logger,
	});
	const telegram = parseTelegram(await secrets.get(tenant.id, "telegram"));
	const services = createServices({
		env,
		tenant,
		db,
		provider,
		logger,
		accounts,
		integrations: {
			upstreams: createUpstreamsFrom(tenant.issuer, {
				google: parseCredentials(await secrets.get(tenant.id, "google")),
				github: parseCredentials(await secrets.get(tenant.id, "github")),
			}),
			telegram:
				telegram &&
				createTelegramBot({
					...telegram,
					apiBaseUrl: env.TELEGRAM_API_BASE_URL.replace(/\/+$/, ""),
				}),
		},
	});
	return { tenant, services, app: createTenantApp({ services, env }), jwks };
}

function parseTelegram(
	value: string | undefined,
): { token: string; username: string; webhookSecret: string } | undefined {
	if (!value) return undefined;
	const parsed: unknown = JSON.parse(value);
	if (typeof parsed !== "object" || parsed === null) return undefined;
	const token: unknown = Reflect.get(parsed, "token");
	const username: unknown = Reflect.get(parsed, "username");
	const webhookSecret: unknown = Reflect.get(parsed, "webhookSecret");
	return typeof token === "string" &&
		typeof username === "string" &&
		typeof webhookSecret === "string"
		? { token, username, webhookSecret }
		: undefined;
}
