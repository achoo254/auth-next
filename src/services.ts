import type { Db } from "mongodb";
import type Provider from "oidc-provider";
import { GRANT_META_COLLECTION } from "./account-portal/grant-directory.js";
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

/** Everything the server-rendered pages need, built once per process. */
export interface AppServices {
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
	readonly upstreams: Upstreams;
	readonly telegram?: TelegramBot;
	/** Per-IP budget for form POSTs and Google/GitHub sign-in starts. */
	readonly formPostsPerMinute: number;
}

export interface ServiceDependencies {
	readonly env: Env;
	readonly db: Db;
	readonly provider: Provider;
	readonly logger: Logger;
	readonly accounts: AccountRepository;
	/** Replaces the env-derived Telegram bot (tests). */
	readonly telegram?: TelegramBot;
	/** Replaces the env-derived Google/GitHub clients (tests). */
	readonly upstreams?: Upstreams;
	readonly formPostsPerMinute?: number;
}

export function createServices(deps: ServiceDependencies): AppServices {
	const { env, db } = deps;
	const telegramConfig = telegramBotConfig(env);
	const secureCookies = new URL(env.ISSUER).protocol === "https:";
	trackSessions(deps.provider, db, deps.logger);
	auditProviderEvents(deps.provider, deps.accounts.audit);
	return {
		issuer: env.ISSUER,
		host: new URL(env.ISSUER).host,
		db,
		provider: deps.provider,
		logger: deps.logger,
		accounts: deps.accounts,
		audit: deps.accounts.audit,
		tokens: new OneTimeTokenStore(db),
		accountTokens: new AccountTokens(db, deps.accounts),
		csrf: createCsrf(env.COOKIE_KEYS, secureCookies),
		upstreams: deps.upstreams ?? createUpstreams(env),
		formPostsPerMinute: deps.formPostsPerMinute ?? 30,
		telegram:
			deps.telegram ??
			(telegramConfig ? createTelegramBot(telegramConfig) : undefined),
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
