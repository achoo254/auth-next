import type { Db } from "mongodb";
import type { KoaContextWithOIDC, RefreshToken } from "oidc-provider";
import { collectionNameFor } from "./mongo-adapter.js";

const DAY = 24 * 60 * 60;

/** A grant left unused this long expires; each refresh restarts the clock. */
export const GRANT_IDLE_SECONDS = 30 * DAY;
/** No grant, and no refresh token of it, outlives this from its sign-in. */
export const GRANT_MAX_SECONDS = 90 * DAY;

function epochNow(): number {
	return Math.floor(Date.now() / 1000);
}

/** Seconds a grant that started at `start` may still live, idle or not. */
export function slidingLifetime(start: number, now = epochNow()): number {
	return Math.min(GRANT_IDLE_SECONDS, start + GRANT_MAX_SECONDS - now);
}

/**
 * `ttl.RefreshToken`: 30 days, but never past 90 days from the sign-in that
 * created the grant (or, without a grant in context, from the first token of
 * the rotation chain, `iiat`). oidc-provider needs a positive integer.
 */
export function refreshTokenTtl(
	ctx: KoaContextWithOIDC | undefined,
	token: RefreshToken,
): number {
	const start = ctx?.oidc?.entities.Grant?.iat ?? token.iiat ?? epochNow();
	return Math.max(1, slidingLifetime(start));
}

/**
 * Builds `rotateRefreshToken`: every refresh rotates (a replayed token
 * revokes the grant), and a successful refresh slides the grant: it now
 * expires 30 days after this refresh, capped at 90 days after sign-in.
 * oidc-provider calls this after the presented token and its grant passed
 * validation and before the new token is issued, and awaits it, so the new
 * expiry is stored before the response. The update only touches a grant
 * that still exists (no upsert), so a grant revoked meanwhile stays gone.
 */
export function createRotateAndSlideGrant(
	db: Db,
): (ctx: KoaContextWithOIDC) => Promise<boolean> {
	const grants = db.collection<{ _id: string }>(collectionNameFor("Grant"));
	return async (ctx) => {
		const grant = ctx.oidc.entities.Grant;
		if (grant?.iat && grant.jti) {
			const now = epochNow();
			const exp = now + slidingLifetime(grant.iat, now);
			if (exp > (grant.exp ?? 0)) {
				const result = await grants.updateOne(
					{ _id: grant.jti },
					{ $set: { "payload.exp": exp, expiresAt: new Date(exp * 1000) } },
				);
				if (result.matchedCount === 1) grant.exp = exp;
			}
		}
		return true;
	};
}
