import type { Collection, Db } from "mongodb";

export const CLIENT_USAGE_COLLECTION = "client_usage";

/** One year plus a month: enough to compare a week with the same week a year earlier. */
export const CLIENT_USAGE_RETENTION_DAYS = 400;

const DAY_SECONDS = 24 * 60 * 60;

/**
 * How the person got into the app: they signed in on the IdP's pages
 * ("interactive"), or a live IdP session let them straight through ("sso").
 */
export const CLIENT_USAGE_KINDS = ["interactive", "sso"] as const;
export type ClientUsageKind = (typeof CLIENT_USAGE_KINDS)[number];

/**
 * One successful sign-in of an account into an app (ADR 0011). Append
 * only, no IP or User-Agent: it exists to count people per app. The TTL
 * index removes it after CLIENT_USAGE_RETENTION_DAYS; deleting the account
 * removes it at once.
 */
export interface ClientUsageDocument {
	/** The tenant the document belongs to. */
	tenantId: string;
	/** The account (OIDC `sub`). */
	sub: string;
	clientId: string;
	at: Date;
	kind: ClientUsageKind;
}

export function clientUsageCollection(db: Db): Collection<ClientUsageDocument> {
	return db.collection<ClientUsageDocument>(CLIENT_USAGE_COLLECTION);
}

/**
 * Reads by week (tenant and time), the first app of an account and the
 * account purge (tenant and account), and the retention TTL. Idempotent;
 * run at startup with the other account-layer indexes.
 */
export async function ensureClientUsageIndexes(db: Db): Promise<void> {
	const usage = clientUsageCollection(db);
	await Promise.all([
		usage.createIndex({ tenantId: 1, at: 1 }, { name: "tenant_at" }),
		usage.createIndex(
			{ tenantId: 1, sub: 1, at: 1 },
			{ name: "tenant_sub_at" },
		),
		usage.createIndex(
			{ at: 1 },
			{
				expireAfterSeconds: CLIENT_USAGE_RETENTION_DAYS * DAY_SECONDS,
				name: "at_ttl",
			},
		),
	]);
}
