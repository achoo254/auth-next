import type { Db } from "mongodb";
import type Provider from "oidc-provider";
import { GRANT_META_COLLECTION } from "./account-portal/device-grants.js";
import {
	SESSION_META_COLLECTION,
	trackSessions,
} from "./account-portal/session-directory.js";
import type { AccountRepository } from "./accounts/account-repository.js";
import { AccountTokens } from "./accounts/account-tokens.js";
import {
	OneTimeTokenStore,
	ensureOneTimeTokenIndexes,
} from "./accounts/one-time-tokens.js";
import { type Upstreams, createUpstreams } from "./accounts/upstream-client.js";
import { ensureAccountIndexes } from "./accounts/user-model.js";
import type { AuditOutbox } from "./audit/audit-outbox.js";
import { ensureAuditOutboxIndexes } from "./audit/audit-outbox.js";
import { auditProviderEvents } from "./audit/provider-events.js";
import type { Env } from "./config/env.js";
import { telegramBotConfig } from "./config/integrations-env.js";
import { type Csrf, createCsrf } from "./http/csrf.js";
import type { Logger } from "./logger.js";
import { type TelegramBot, createTelegramBot } from "./telegram/bot-client.js";
import type { Tenancy } from "./tenants/tenancy.js";
import type { Tenant } from "./tenants/tenant.js";

/**
 * Everything the server-rendered pages of one tenant need, built once per
 * tenant. Every store in it is bound to `tenant`.
 */
export interface AppServices {
	readonly tenant: Tenant;
	readonly issuer: string;
	readonly host: string;
	readonly db: Db;
	readonly provider: Provider;
	readonly logger: Logger;
	readonly accounts: AccountRepository;
	/** Credential events waiting for delivery to Localman's audit log. */
	readonly audit: AuditOutbox;
	/** Tokens not bound to an account (OAuth sign-in state, pending profiles). */
	readonly tokens: OneTimeTokenStore;
	/** Account-bound one-time tokens, checked against `securityVersion`. */
	readonly accountTokens: AccountTokens;
	readonly csrf: Csrf;
	/** COOKIE_KEYS: the first signs, the others still verify. */
	readonly cookieKeys: readonly string[];
	readonly upstreams: Upstreams;
	readonly telegram?: TelegramBot;
	/** Per-IP budget for form POSTs and Google/GitHub sign-in starts. */
	readonly formPostsPerMinute: number;
	/** Claiming domains (/claim) and tenant administration (/admin), when enabled. */
	readonly tenancy?: Tenancy;
}

export interface ServiceDependencies {
	readonly env: Env;
	readonly tenant: Tenant;
	readonly db: Db;
	readonly provider: Provider;
	readonly logger: Logger;
	readonly accounts: AccountRepository;
	/** Replaces the env-derived Telegram bot (tests). */
	readonly telegram?: TelegramBot;
	/** Replaces the env-derived Google/GitHub clients (tests). */
	readonly upstreams?: Upstreams;
	/**
	 * A registry tenant's own sign-in providers and bot. When given, nothing
	 * falls back to the environment, which configures the primary tenant.
	 */
	readonly integrations?: {
		readonly upstreams: Upstreams;
		readonly telegram?: TelegramBot;
	};
	readonly formPostsPerMinute?: number;
	readonly tenancy?: Tenancy;
}

export function createServices(deps: ServiceDependencies): AppServices {
	const { env, tenant, db } = deps;
	// A store wired to another tenant would read, write or sign as that one.
	if (
		deps.accounts.tenant.id !== tenant.id ||
		deps.accounts.audit.tenant.id !== tenant.id
	) {
		throw new Error("Account stores belong to another tenant");
	}
	const telegramConfig = telegramBotConfig(env);
	const secureCookies = new URL(tenant.issuer).protocol === "https:";
	trackSessions(deps.provider, { db, tenant }, deps.logger);
	auditProviderEvents(deps.provider, deps.accounts.audit);
	return {
		tenant,
		issuer: tenant.issuer,
		host: new URL(tenant.issuer).host,
		db,
		provider: deps.provider,
		logger: deps.logger,
		accounts: deps.accounts,
		audit: deps.accounts.audit,
		tokens: new OneTimeTokenStore(db, tenant),
		accountTokens: new AccountTokens(db, deps.accounts),
		csrf: createCsrf(env.COOKIE_KEYS, secureCookies),
		cookieKeys: env.COOKIE_KEYS,
		upstreams:
			deps.integrations?.upstreams ??
			deps.upstreams ??
			createUpstreams(env, tenant.issuer),
		formPostsPerMinute: deps.formPostsPerMinute ?? 30,
		tenancy: deps.tenancy,
		telegram: deps.integrations
			? deps.integrations.telegram
			: (deps.telegram ??
				(telegramConfig ? createTelegramBot(telegramConfig) : undefined)),
	};
}

/** Collections owned by the account layer; idempotent, run at startup. */
export async function ensureAccountLayerIndexes(db: Db): Promise<void> {
	await Promise.all([
		ensureAccountIndexes(db),
		ensureOneTimeTokenIndexes(db),
		ensureAuditOutboxIndexes(db),
		...[SESSION_META_COLLECTION, GRANT_META_COLLECTION].map((name) =>
			db
				.collection(name)
				.createIndex(
					{ expiresAt: 1 },
					{ expireAfterSeconds: 0, name: "expiresAt_ttl" },
				),
		),
	]);
}
