import type { z } from "zod";
import {
	appClientSecret,
	appDevUrl,
	appOrigin,
	checkDevPair,
} from "./primary-app-env.js";

/**
 * Knowledge Base (primary tenant only). Both pairs are optional and
 * all-or-nothing: kb-web exists only with KB_WEB_URL and its secret,
 * kb-web-dev only with KB_WEB_DEV_URL (loopback) and its secret; with
 * neither the IdP boots as before.
 */
export const kbEnvShape = {
	KB_WEB_URL: appOrigin,
	KB_WEB_CLIENT_SECRET: appClientSecret.optional(),
	/** Origin of a developer's local Knowledge Base, e.g. http://localhost:5321. */
	KB_WEB_DEV_URL: appDevUrl,
	KB_WEB_DEV_CLIENT_SECRET: appClientSecret.optional(),
};

/** The origin variables, which must be public https in production. */
export const KB_URL_KEYS = ["KB_WEB_URL"] as const;

/** Reports a Knowledge Base client of which only the URL or the secret is set. */
export function checkKbGroups(
	env: Readonly<Record<string, unknown>>,
	ctx: z.RefinementCtx,
): void {
	checkDevPair(env, "KB_WEB_URL", "KB_WEB_CLIENT_SECRET", ctx);
	checkDevPair(env, "KB_WEB_DEV_URL", "KB_WEB_DEV_CLIENT_SECRET", ctx);
}
