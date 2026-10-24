import { randomBytes } from "node:crypto";
import type { Collection, Db } from "mongodb";
import type { Locale } from "../i18n/locales.js";
import type { AccountProfile } from "../oidc/claims.js";

/** Every way to sign in, in the order the buttons appear (ADR 0004, 0008). */
export const UPSTREAM_PROVIDERS = ["apple", "google", "github"] as const;
export type UpstreamProvider = (typeof UPSTREAM_PROVIDERS)[number];

export function isUpstreamProvider(value: unknown): value is UpstreamProvider {
	return UPSTREAM_PROVIDERS.some((provider) => provider === value);
}

export interface ProviderDetail {
	/** The email the provider verified when the link was made. */
	email?: string;
	/** GitHub login (username at GitHub). */
	login?: string;
	/**
	 * Apple only: the refresh token of the link, kept solely to revoke the
	 * authorization at Apple when the link goes away (Apple requires it).
	 * Usable only with a client secret signed by the Apple key, which lives
	 * in a file outside the database. Never shown or logged.
	 */
	revocationToken?: string;
	linkedAt: Date;
}

/**
 * One account in the `accounts` collection; `_id` is the OIDC `sub`.
 * Accounts sign in only through a linked Google, GitHub or Apple account
 * (and the review account of ADR 0010 while that sign-in is on). Documents
 * from before that may still hold `passwordHash`, `recoveryCodeHashes`,
 * `recoveryCodesCreatedAt`, `credentialsChangedAt` or
 * `securityReviewPendingSince`; they are left in place but deliberately
 * absent from this type, so nothing reads them.
 */
export interface AccountDocument {
	_id: string;
	/**
	 * The tenant the account belongs to; usernames, emails and linked
	 * provider accounts are unique per tenant only.
	 */
	tenantId: string;
	/** Lowercase, `^[a-z0-9_]{3,30}$`, unique. */
	username: string;
	/**
	 * Normalised (trimmed, lowercase), unique when present. Absent after a
	 * Google/GitHub user proved they own it and reclaimed it (see
	 * `reclaimedEmail`).
	 */
	email?: string;
	/** Who vouched for `email`; null for an unverified address (older accounts). */
	emailVerifiedBy: UpstreamProvider | null;
	/**
	 * Bumped by every security-relevant change: linking or unlinking
	 * Google/GitHub/Apple/Telegram, an email reclaimed. Account-bound one-time
	 * tokens carry the value they were issued at and stop working once it
	 * moves on (account-tokens.ts). Absent means 0.
	 */
	securityVersion?: number;
	name?: string;
	picture?: string;
	/** Provider-side account ids (Google/Apple `sub`, GitHub numeric id). */
	providers: { google?: string; github?: string; apple?: string };
	/**
	 * What each provider said at link time, shown on /account: its verified
	 * email and (GitHub) login. Links made
	 * before this field existed have none ("không rõ").
	 */
	providerDetails?: {
		google?: ProviderDetail;
		github?: ProviderDetail;
		apple?: ProviderDetail;
	};
	telegram?: {
		chatId: string;
		linkedAt: Date;
		/** Telegram @username and display name at link time, for the account page. */
		username?: string;
		name?: string;
	};
	/**
	 * Language the Telegram bot writes to this account in: the language of
	 * the /account page the link was made from, then of the last /account
	 * visit while linked. Absent (older links) means English for notices.
	 * Not security-relevant, so changing it does not bump `securityVersion`.
	 */
	telegramLocale?: Locale;
	/** The unverified email this account lost to its verified owner. */
	reclaimedEmail?: { email: string; at: Date };
	createdAt: Date;
	disabledAt?: Date;
	/** Made by the review-only password sign-in (ADR 0010), the only one it opens. */
	reviewLogin?: true;
}

export const ACCOUNTS_COLLECTION = "accounts";
export const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

export function accountsCollection(db: Db): Collection<AccountDocument> {
	return db.collection<AccountDocument>(ACCOUNTS_COLLECTION);
}

export function normalizeEmail(value: string): string {
	return value.trim().toLowerCase();
}

export function normalizeUsername(value: string): string {
	return value.trim().toLowerCase().replace(/^@/, "");
}

export function isValidEmail(value: string): boolean {
	return value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}

export function isValidUsername(value: string): boolean {
	return USERNAME_PATTERN.test(value);
}

/** Opaque, never-reused subject identifier. */
export function newAccountId(): string {
	return `acc_${randomBytes(16).toString("base64url")}`;
}

/**
 * The linked provider accounts that can sign in here now: linked to
 * the account and enabled on this IdP. Telegram only receives notices, so
 * it is not a way in.
 */
export function usableSignInProviders(
	account: Pick<AccountDocument, "providers">,
	enabled: readonly UpstreamProvider[],
): UpstreamProvider[] {
	return UPSTREAM_PROVIDERS.filter(
		(provider) =>
			account.providers[provider] !== undefined && enabled.includes(provider),
	);
}

export function toAccountProfile(account: AccountDocument): AccountProfile {
	return {
		sub: account._id,
		username: account.username,
		email: account.email,
		emailVerified: account.emailVerifiedBy !== null,
		name: account.name,
		picture: account.picture,
		telegramLinked: account.telegram !== undefined,
		...(account.providers.google
			? { googleSub: account.providers.google }
			: {}),
		...(account.telegram
			? {
					telegram: {
						chatId: account.telegram.chatId,
						...(account.telegram.username
							? { username: account.telegram.username }
							: {}),
					},
				}
			: {}),
	};
}

/**
 * The keys unique within a tenant. Each index leads with `tenantId`, so the
 * same Google account, email or username can exist once in every tenant.
 * Partial ones skip unset fields.
 */
const TENANT_UNIQUE_KEYS = [
	{ key: "username", name: "tenant_username" },
	{ key: "email", name: "tenant_email_when_set" },
	{ key: "providers.google", name: "tenant_providers_google" },
	{ key: "providers.github", name: "tenant_providers_github" },
	{ key: "providers.apple", name: "tenant_providers_apple" },
	{ key: "telegram.chatId", name: "tenant_telegram_chat" },
] as const;

/**
 * Creates the per-tenant unique indexes. The global unique indexes of the
 * single-tenant era are dropped by the startup migration
 * (tenant-migration.ts), once every account carries a `tenantId`.
 */
export async function ensureAccountIndexes(db: Db): Promise<void> {
	const accounts = accountsCollection(db);
	// Early databases had a plain unique index on email, which cannot hold
	// several accounts without an email; replace it with the partial one.
	const legacy = await accounts.indexExists("email_1").catch(() => false);
	if (legacy) await accounts.dropIndex("email_1");
	await Promise.all(
		TENANT_UNIQUE_KEYS.map(({ key, name }) =>
			accounts.createIndex(
				{ tenantId: 1, [key]: 1 },
				key === "username"
					? { unique: true, name }
					: {
							unique: true,
							name,
							partialFilterExpression: { [key]: { $type: "string" } },
						},
			),
		),
	);
}
