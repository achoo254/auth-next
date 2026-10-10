import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { formValue, readCookie } from "./form.js";

/**
 * CSRF protection for every server-rendered form: a random per-browser
 * secret in an HttpOnly cookie, and in each form an HMAC of that secret and
 * a scope (the interaction uid or the IdP session uid). A
 * token minted for one interaction or session is useless for another, and a
 * cross-site page can neither read the cookie nor compute the HMAC.
 */
export interface Csrf {
	/** Token to embed in a form for `scope`; sets the browser cookie if needed. */
	token(req: Request, res: Response, scope: string): string;
	/** True when the posted `csrf` field matches this browser and `scope`. */
	verify(req: Request, scope: string): boolean;
}

const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function sign(key: string, secret: string, scope: string): Buffer {
	return createHmac("sha256", key).update(`csrf\n${scope}\n${secret}`).digest();
}

export function createCsrf(
	keys: readonly string[],
	secureCookies: boolean,
): Csrf {
	const signingKey = keys[0];
	if (!signingKey) throw new Error("CSRF needs at least one key");
	const cookieName = secureCookies ? "__Host-csrf" : "csrf";

	const browserSecret = (req: Request, res: Response): string => {
		const existing = readCookie(req, cookieName);
		if (existing && /^[\w-]{43}$/.test(existing)) return existing;
		const secret = randomBytes(32).toString("base64url");
		res.cookie(cookieName, secret, {
			httpOnly: true,
			sameSite: "lax",
			secure: secureCookies,
			path: "/",
			maxAge: COOKIE_MAX_AGE_MS,
		});
		return secret;
	};

	return {
		token(req, res, scope) {
			return sign(signingKey, browserSecret(req, res), scope).toString(
				"base64url",
			);
		},
		verify(req, scope) {
			const secret = readCookie(req, cookieName);
			const posted = formValue(req, "csrf");
			if (!secret || !posted) return false;
			const received = Buffer.from(posted, "base64url");
			// Older keys still verify so rotating COOKIE_KEYS does not break
			// forms that are already open.
			return keys.some((key) => {
				const expected = sign(key, secret, scope);
				return (
					received.length === expected.length &&
					timingSafeEqual(received, expected)
				);
			});
		},
	};
}
