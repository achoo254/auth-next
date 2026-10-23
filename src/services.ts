import type { JWTVerifyGetKey } from "jose";
import type { Db } from "mongodb";
import type Provider from "oidc-provider";
import {
	type AccountApiLimits,
	DEFAULT_ACCOUNT_API_LIMITS,
} from "./account-api/account-api-limits.js";
import { idTokenVerificationKeys } from "./account-api/recent-auth.js";
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
import {
	auditProviderEvents,
	forgetRevokedPushDevices,
} from "./audit/provider-events.js";
import type { Env } from "./config/env.js";
import { telegramBotConfig } from "./config/integrations-env.js";
import { apnsConfig, partialApnsSettings } from "./config/ios-env.js";
import {
	type ReviewLoginConfig,
	reviewLoginConfig,
} from "./config/review-login-env.js";
import { type Csrf, createCsrf } from "./http/csrf.js";
import type { Logger } from "./logger.js";
import type { SigningJwks } from "./oidc/jwks.js";
import { ApnsClient, type PushSender } from "./push/apns-client.js";
import { PushDevices, ensurePushDeviceIndexes } from "./push/push-devices.js";
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
	/** The review-only password sign-in (ADR 0010): primary tenant, when on. */
	readonly reviewLogin?: ReviewLoginConfig;
	/** Per-IP budget for form POSTs and Google/GitHub sign-in starts. */
	readonly formPostsPerMinute: number;
	/** Claiming domains (/claim) and tenant administration (/admin), when enabled. */
	readonly tenancy?: Tenancy;
	/** Verifies the tenant's own ID tokens (re-authentication on /api/account). */
	readonly idTokenKeys: JWTVerifyGetKey;
	/** Budgets of /api/account. */
	readonly accountApiLimits: AccountApiLimits;
	/** Phones of the iOS account app that receive security notices. */
	readonly pushDevices: PushDevices;
	/** APNs; undefined when push is off (primary tenant with APNS_* only). */
	readonly pushSender?: PushSender;
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
	/** The tenant's signing keys (only their public half is kept). */
	readonly jwks: SigningJwks;
	/** Replaces the env-derived APNs sender (tests). */
	readonly pushSender?: PushSender;
	readonly accountApiLimits?: AccountApiLimits;
}

/** APNs for the primary tenant, from APNS_*; never for a registry tenant. */
function envPushSender(deps: ServiceDependencies): PushSender | undefined {
	if (deps.integrations) return undefined;
	const partial = partialApnsSettings(deps.env);
	if (partial.length > 0) {
		deps.logger.warn(
			{ set: partial },
			"Push notices off: APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID and APNS_TOPIC go together",
		);
	}
	const config = apnsConfig(deps.env);
	return config ? new ApnsClient(config, deps.logger) : undefined;
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
	const pushDevices = new PushDevices(db, tenant);
	forgetRevokedPushDevices(deps.provider, pushDevices, deps.logger);
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
		// Never for a registry tenant; reads the hash file (a bad one stops startup).
		reviewLogin: deps.integrations ? undefined : reviewLoginConfig(env),
		formPostsPerMinute: deps.formPostsPerMinute ?? 30,
		tenancy: deps.tenancy,
		idTokenKeys: idTokenVerificationKeys(deps.jwks),
		accountApiLimits: deps.accountApiLimits ?? DEFAULT_ACCOUNT_API_LIMITS,
		pushDevices,
		pushSender: deps.integrations
			? undefined
			: (deps.pushSender ?? envPushSender(deps)),
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
		ensurePushDeviceIndexes(db),
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
