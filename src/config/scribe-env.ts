import { z } from "zod";
import { PRIVATE_USE_REDIRECT } from "../oidc/chat-clients.js";
import { SCRIBE_MOBILE_REDIRECT_URI } from "../oidc/scribe-clients.js";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

const secret = z.string().min(32, "must be at least 32 characters");

/**
 * Scribe (primary tenant only). Optional: without SCRIBE_WEB_CLIENT_SECRET
 * the IdP registers no Scribe client and boots as before. The development
 * client is all-or-nothing and only ever redirects to a loopback origin.
 */
export const scribeEnvShape = {
	SCRIBE_WEB_URL: z
		.url({ protocol: /^https?$/, error: "must be an http(s) URL" })
		.default("https://scribe.hoandat.com"),
	SCRIBE_WEB_CLIENT_SECRET: secret.optional(),
	SCRIBE_MOBILE_REDIRECT_URI: z
		.string()
		.default(SCRIBE_MOBILE_REDIRECT_URI)
		.refine(
			(value) => PRIVATE_USE_REDIRECT.test(value),
			"must be a private-use scheme redirect like com.example.app:/auth/callback",
		),
	/** Origin of a developer's local Scribe, e.g. http://localhost:5174. */
	SCRIBE_WEB_DEV_URL: z
		.url({ protocol: /^https?$/, error: "must be an http(s) URL" })
		.refine((value) => {
			const url = URL.parse(value);
			return url !== null && LOOPBACK_HOSTNAMES.has(url.hostname);
		}, "must be on localhost, 127.0.0.1 or [::1]")
		.optional(),
	SCRIBE_WEB_DEV_CLIENT_SECRET: secret.optional(),
};

/** Reports a development client that is only partly configured. */
export function checkScribeDevGroup(
	env: {
		readonly SCRIBE_WEB_DEV_URL?: string;
		readonly SCRIBE_WEB_DEV_CLIENT_SECRET?: string;
	},
	ctx: z.RefinementCtx,
): void {
	const hasUrl = env.SCRIBE_WEB_DEV_URL !== undefined;
	if (hasUrl === (env.SCRIBE_WEB_DEV_CLIENT_SECRET !== undefined)) return;
	ctx.addIssue({
		code: "custom",
		path: [hasUrl ? "SCRIBE_WEB_DEV_CLIENT_SECRET" : "SCRIBE_WEB_DEV_URL"],
		message:
			"must be set together with SCRIBE_WEB_DEV_URL and SCRIBE_WEB_DEV_CLIENT_SECRET",
	});
}
