import type { RequestHandler } from "express";
import type { CommandStartedEvent } from "mongodb";
import type { RateLimitRule } from "../../http/security.js";
import type { Tenant } from "../../tenants/tenant.js";

export interface TestIdpOptions {
	/**
	 * "auto" signs TEST_ACCOUNT in without pages; "real" serves the real
	 * login and consent pages against MongoDB accounts; a handler replaces
	 * the interaction pages.
	 */
	readonly interactions: "auto" | "real" | RequestHandler;
	readonly rateLimits?: readonly RateLimitRule[];
	/**
	 * Extra environment, e.g. Telegram credentials. Google and GitHub (the
	 * only sign-in) are always configured against the fakes, unless
	 * `withoutUpstreams` is set.
	 */
	readonly env?: Readonly<Record<string, string>>;
	readonly withoutUpstreams?: boolean;
	readonly formPostsPerMinute?: number;
	/**
	 * Serves another tenant than the primary one (id, domain, brand; the
	 * issuer stays the test server's). With `mongoUrl`, several test IdPs
	 * share one database, like tenants of one process.
	 */
	readonly tenant?: Pick<Tenant, "id" | "domain" | "displayName">;
	readonly mongoUrl?: string;
	/** Sees every command the IdP sends to MongoDB. */
	readonly onMongoCommand?: (event: CommandStartedEvent) => void;
}
