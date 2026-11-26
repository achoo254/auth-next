import type {
	AccessToken,
	ClientCredentials,
	JWTStructured,
} from "oidc-provider";
import type { AccountStore } from "./claims.js";

/**
 * JWT claim carrying how many tunnels the account may hold open at once.
 * Tunelo reads it at handshake (`idp-token-verifier.ts` in localman-next),
 * caps it at 100 and falls back to its default (3) when it is absent.
 */
export const TUNNEL_QUOTA_CLAIM = "max_tunnels";

function audienceIncludes(aud: unknown, target: string): boolean {
	return Array.isArray(aud) ? aud.includes(target) : aud === target;
}

/** A quota Tunelo accepts: a whole number, at least 1. */
function isQuota(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * `formats.customizers.jwt`: puts the account's tunnel quota on access tokens
 * whose audience is Tunelo. Only accounts with `maxTunnels` set get the
 * claim; client-credential tokens have no account and get none.
 */
export async function addTunnelQuotaClaim(
	accounts: AccountStore,
	tunnelAudience: string,
	token: AccessToken | ClientCredentials,
	parts: JWTStructured,
): Promise<void> {
	if (!audienceIncludes(parts.payload.aud, tunnelAudience)) return;
	if (!("accountId" in token) || typeof token.accountId !== "string") return;
	const profile = await accounts.findAccount(token.accountId);
	if (isQuota(profile?.maxTunnels)) {
		parts.payload[TUNNEL_QUOTA_CLAIM] = profile.maxTunnels;
	}
}
