import type { Account, AccountClaims, FindAccount } from "oidc-provider";

/** What the IdP knows about one account, independent of storage. */
export interface AccountProfile {
	/** Stable subject identifier; never reused. */
	readonly sub: string;
	readonly username: string;
	readonly email?: string;
	/**
	 * True only when Google or GitHub vouched for the email; a typed-in email
	 * is never treated as verified because the IdP sends no mail.
	 */
	readonly emailVerified: boolean;
	readonly name?: string;
	readonly picture?: string;
	readonly telegramLinked: boolean;
	/** The linked Telegram chat, when there is one (userinfo only). */
	readonly telegram?: {
		readonly chatId: string;
		readonly username?: string;
	};
	/** A password reset is waiting for its security review (not a claim). */
	readonly securityReviewPending?: boolean;
}

/**
 * Account lookup used by oidc-provider. Phase 02 backs this with the Mongo
 * user model; until then only the in-memory store exists.
 */
export interface AccountStore {
	findAccount(sub: string): Promise<AccountProfile | undefined>;
}

/** Scope → claims released for it; `openid` always yields `sub`. */
export const CLAIMS_BY_SCOPE = {
	openid: ["sub"],
	profile: ["preferred_username", "name", "picture", "telegram_linked"],
	email: ["email", "email_verified"],
	telegram: ["telegram_chat_id", "telegram_username"],
} as const;

/**
 * Claims released only at the userinfo endpoint, never in an ID token
 * (which travels through the browser and client logs).
 */
const USERINFO_ONLY_CLAIMS = new Set(CLAIMS_BY_SCOPE.telegram);

/**
 * Every claim value this issuer can release for an account and `use`; the
 * provider then masks them to the granted scopes and claims.
 */
export function profileToClaims(
	profile: AccountProfile,
	/** oidc-provider's `use`: "id_token" or "userinfo". */
	use = "userinfo",
): AccountClaims {
	const claims: AccountClaims = {
		sub: profile.sub,
		preferred_username: profile.username,
		email: profile.email,
		email_verified:
			profile.email === undefined ? undefined : profile.emailVerified,
		name: profile.name,
		picture: profile.picture,
		telegram_linked: profile.telegramLinked,
		telegram_chat_id: profile.telegram?.chatId,
		telegram_username: profile.telegram?.username,
	};
	if (use !== "userinfo") {
		for (const claim of USERINFO_ONLY_CLAIMS) delete claims[claim];
	}
	return claims;
}

/**
 * Adapts an AccountStore to oidc-provider's `findAccount`. The provider masks
 * the returned claims down to the granted scopes and claims.
 */
export function createFindAccount(store: AccountStore): FindAccount {
	return async (_ctx, sub): Promise<Account | undefined> => {
		const profile = await store.findAccount(sub);
		if (!profile) return undefined;
		return {
			accountId: profile.sub,
			claims: (use) => profileToClaims(profile, use),
		};
	};
}

/** Fixed set of accounts kept in memory; for tests and pre-account phases. */
export function createInMemoryAccountStore(
	profiles: readonly AccountProfile[],
): AccountStore {
	const bySub = new Map(profiles.map((profile) => [profile.sub, profile]));
	return {
		findAccount: async (sub) => bySub.get(sub),
	};
}
