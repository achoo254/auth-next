import type { Account, AccountClaims, FindAccount } from "oidc-provider";
import { MIU_CLIENT_IDS } from "./miu-clients.js";

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
	/** The linked Google account's `sub` (`google_sub`, Miu World only). */
	readonly googleSub?: string;
}

/**
 * Account lookup used by oidc-provider. Phase 02 backs this with the Mongo
 * user model; until then only the in-memory store exists.
 */
export interface AccountStore {
	findAccount(sub: string): Promise<AccountProfile | undefined>;
}

/**
 * Scope → claims released for it; `openid` always yields `sub`, and `amr`
 * (how the session signed in: "fed", the provider, "reauth" after a proven
 * fresh authentication; upstream-pending.ts) for the ID token. oidc-provider
 * only puts `amr` there when a granted scope lists it.
 */
export const CLAIMS_BY_SCOPE = {
	openid: ["sub", "amr"],
	profile: ["preferred_username", "name", "picture", "telegram_linked"],
	email: ["email", "email_verified", "google_sub"],
	telegram: ["telegram_chat_id", "telegram_username"],
} as const;

/**
 * Claims released only at the userinfo endpoint, never in an ID token
 * (which travels through the browser and client logs).
 */
const USERINFO_ONLY_CLAIMS = new Set([
	...CLAIMS_BY_SCOPE.telegram,
	"google_sub",
]);

/**
 * Clients that receive `google_sub`: Miu World matches it against the
 * Google id of parents from its former direct Google sign-in before linking
 * them (docs/integration-guide.md). No other client ever gets it.
 */
const GOOGLE_SUB_CLIENTS: ReadonlySet<string> = new Set(
	Object.values(MIU_CLIENT_IDS),
);

/**
 * Every claim value this issuer can release for an account and `use`; the
 * provider then masks them to the granted scopes and claims.
 */
export function profileToClaims(
	profile: AccountProfile,
	/** oidc-provider's `use`: "id_token" or "userinfo". */
	use = "userinfo",
	/** The client asking; `google_sub` is only ever for GOOGLE_SUB_CLIENTS. */
	clientId?: string,
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
		google_sub:
			clientId !== undefined && GOOGLE_SUB_CLIENTS.has(clientId)
				? profile.googleSub
				: undefined,
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
	return async (ctx, sub): Promise<Account | undefined> => {
		const profile = await store.findAccount(sub);
		if (!profile) return undefined;
		const clientId = ctx.oidc.client?.clientId;
		return {
			accountId: profile.sub,
			claims: (use) => profileToClaims(profile, use, clientId),
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
