import { z } from "zod";
import { PRIVATE_USE_REDIRECT } from "../oidc/chat-clients.js";

/*
 * Building blocks of the environment of a primary-tenant app (Scribe, Miu
 * World): an optional web client, the app's private-use redirect and an
 * all-or-nothing development client that only ever redirects to loopback.
 */

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A client secret; long enough to resist offline guessing. */
export const appClientSecret = z
	.string()
	.min(32, "must be at least 32 characters");

/** The origin of the app's production site, `fallback` when unset. */
export function appWebUrl(fallback: string) {
	return z
		.url({ protocol: /^https?$/, error: "must be an http(s) URL" })
		.default(fallback);
}

/** The app's private-use scheme redirect (RFC 8252 §7.1), `fallback` when unset. */
export function appMobileRedirect(fallback: string) {
	return z
		.string()
		.default(fallback)
		.refine(
			(value) => PRIVATE_USE_REDIRECT.test(value),
			"must be a private-use scheme redirect like com.example.app:/auth/callback",
		);
}

/** Origin of a developer's local app, e.g. http://localhost:5174. */
export const appDevUrl = z
	.url({ protocol: /^https?$/, error: "must be an http(s) URL" })
	.refine((value) => {
		const url = URL.parse(value);
		return url !== null && LOOPBACK_HOSTNAMES.has(url.hostname);
	}, "must be on localhost, 127.0.0.1 or [::1]")
	.optional();

/** Reports a development client of which only the URL or the secret is set. */
export function checkDevPair(
	env: Readonly<Record<string, unknown>>,
	urlKey: string,
	secretKey: string,
	ctx: z.RefinementCtx,
): void {
	const hasUrl = env[urlKey] !== undefined;
	if (hasUrl === (env[secretKey] !== undefined)) return;
	ctx.addIssue({
		code: "custom",
		path: [hasUrl ? secretKey : urlKey],
		message: `must be set together with ${urlKey} and ${secretKey}`,
	});
}
