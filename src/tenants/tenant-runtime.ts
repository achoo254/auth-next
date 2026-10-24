import type { Db } from "mongodb";
import { AccountRepository } from "../accounts/account-repository.js";
import { AuditOutbox } from "../audit/audit-outbox.js";
import type { Env } from "../config/env.js";
import type { Logger } from "../logger.js";
import type { SigningJwks } from "../oidc/jwks.js";
import { createProvider } from "../oidc/provider.js";
import { type AppServices, createServices } from "../services.js";
import {
	envClientSecrets,
	envMiuClients,
	envScribeClients,
	envTenant,
} from "./env-tenant.js";
import type { Tenant } from "./tenant.js";

/** Everything the IdP serves with, built once at startup. */
export interface TenantRuntime {
	readonly tenant: Tenant;
	readonly services: AppServices;
	readonly jwks: SigningJwks;
}

/**
 * The primary tenant, from the environment, signing with the keys read
 * from SIGNING_KEYS_PATH: the only runtime this IdP has.
 */
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
		chatMobileRedirectUri: env.CHAT_MOBILE_REDIRECT_URI,
		scribeClients: envScribeClients(env),
		miuClients: envMiuClients(env),
		clientSecrets: envClientSecrets(env),
		accountStore: accounts,
		logger,
	});
	const services = createServices({
		env,
		tenant,
		db,
		provider,
		jwks,
		logger,
		accounts,
	});
	return {
		tenant,
		services,
		jwks,
	};
}
