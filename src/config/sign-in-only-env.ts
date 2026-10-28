import { z } from "zod";
import { appClientSecret, checkDevPair } from "./primary-app-env.js";

/** An app's origin, e.g. https://tieude.hoandat.com. */
const appOrigin = z
	.url({ protocol: /^https?$/, error: "must be an http(s) URL" })
	.optional();

/**
 * Tiểu Đệ, Tử Vi, Clip and Web Nhanh (primary tenant only). Each is optional and
 * all-or-nothing: the IdP registers an app's web client only when both its
 * origin and its client secret are set, and boots as before when neither is.
 */
export const signInOnlyEnvShape = {
	TIEUDE_WEB_URL: appOrigin,
	TIEUDE_WEB_CLIENT_SECRET: appClientSecret.optional(),
	TUVI_WEB_URL: appOrigin,
	TUVI_WEB_CLIENT_SECRET: appClientSecret.optional(),
	CLIP_WEB_URL: appOrigin,
	CLIP_WEB_CLIENT_SECRET: appClientSecret.optional(),
	WEBNHANH_WEB_URL: appOrigin,
	WEBNHANH_WEB_CLIENT_SECRET: appClientSecret.optional(),
};

/** The origin variables, which must be public https in production. */
export const SIGN_IN_ONLY_URL_KEYS = [
	"TIEUDE_WEB_URL",
	"TUVI_WEB_URL",
	"CLIP_WEB_URL",
	"WEBNHANH_WEB_URL",
] as const;

/** Reports an app of which only the URL or the secret is set. */
export function checkSignInOnlyGroups(
	env: Readonly<Record<string, unknown>>,
	ctx: z.RefinementCtx,
): void {
	checkDevPair(env, "TIEUDE_WEB_URL", "TIEUDE_WEB_CLIENT_SECRET", ctx);
	checkDevPair(env, "TUVI_WEB_URL", "TUVI_WEB_CLIENT_SECRET", ctx);
	checkDevPair(env, "CLIP_WEB_URL", "CLIP_WEB_CLIENT_SECRET", ctx);
	checkDevPair(env, "WEBNHANH_WEB_URL", "WEBNHANH_WEB_CLIENT_SECRET", ctx);
}
