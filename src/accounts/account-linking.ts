import type { AccountRepository } from "./account-repository.js";
import {
	type AccountDocument,
	type UpstreamProvider,
	normalizeEmail,
} from "./user-model.js";
import type { GuardedWrite } from "./versioned-write.js";

/** What Google, GitHub or Apple told us about the person signing in. */
export interface UpstreamProfile {
	readonly provider: UpstreamProvider;
	/** Google/Apple `sub` or GitHub numeric id, as a string. */
	readonly providerId: string;
	/** Only set when the provider marks it verified. */
	readonly verifiedEmail?: string;
	/** GitHub login (username at GitHub). */
	readonly login?: string;
	readonly name?: string;
	readonly picture?: string;
	/**
	 * Apple refresh token: stored with the link only to revoke the
	 * authorization at Apple when it is unlinked. Never logged.
	 */
	readonly revocationToken?: string;
	/**
	 * The provider proved a fresh authentication, asked for by the client
	 * (`UpstreamChecks.freshLogin`; Google and Apple only): `amr` "reauth".
	 */
	readonly freshAuth?: boolean;
}

export type UpstreamLoginDecision =
	/** This provider account is already linked: sign in. */
	| { readonly kind: "login"; readonly account: AccountDocument }
	/** Same verified email on both sides: link, then sign in. */
	| { readonly kind: "auto-link"; readonly account: AccountDocument }
	/**
	 * No account owns this email: create one after choosing a username. When
	 * an account holds the address unverified (`reclaimsFrom`), the email is
	 * taken from it at creation; that account keeps its username login.
	 */
	| {
			readonly kind: "signup";
			/** Normalised (trimmed, lowercase). */
			readonly email: string;
			readonly reclaimsFrom?: AccountDocument;
	  }
	| {
			readonly kind: "rejected";
			readonly reason:
				| "no-verified-email"
				| "disabled"
				| "other-provider-account";
	  };

/**
 * Linking rules. A provider is linked automatically only when both sides
 * vouch for the email: the provider verified it now, and the existing
 * account had it verified by a provider before. A typed-in (unverified)
 * email proves nothing (anyone can type the victim's address first), so it
 * is never linked: the verified owner gets a new account and reclaims the
 * address from the unverified one.
 */
export async function decideUpstreamLogin(
	accounts: AccountRepository,
	profile: UpstreamProfile,
): Promise<UpstreamLoginDecision> {
	const linked = await accounts.findByProvider(
		profile.provider,
		profile.providerId,
	);
	if (linked) {
		return linked.disabledAt
			? { kind: "rejected", reason: "disabled" }
			: { kind: "login", account: linked };
	}
	if (!profile.verifiedEmail) {
		return { kind: "rejected", reason: "no-verified-email" };
	}
	const email = normalizeEmail(profile.verifiedEmail);
	const byEmail = await accounts.findByEmail(email);
	if (!byEmail) return { kind: "signup", email };
	if (byEmail.emailVerifiedBy === null) {
		return { kind: "signup", email, reclaimsFrom: byEmail };
	}
	if (byEmail.disabledAt) return { kind: "rejected", reason: "disabled" };
	if (byEmail.providers[profile.provider]) {
		// That account already uses a different account of this provider;
		// replacing it silently would lock its owner out of that login.
		return { kind: "rejected", reason: "other-provider-account" };
	}
	return { kind: "auto-link", account: byEmail };
}

/**
 * Links `profile` to `account`, verifying the email when it matches. With
 * `expectedVersion`, only if the account is still at that security version.
 */
export function linkUpstream(
	accounts: AccountRepository,
	account: AccountDocument,
	profile: UpstreamProfile,
	expectedVersion?: number,
): Promise<GuardedWrite> {
	return accounts.links.linkProvider(account, profile, expectedVersion);
}
