import type { z } from "zod";
import { SCRIBE_MOBILE_REDIRECT_URI } from "../oidc/scribe-clients.js";
import {
	appClientSecret,
	appDevUrl,
	appMobileRedirect,
	appWebUrl,
	checkDevPair,
} from "./primary-app-env.js";

/**
 * Scribe (primary tenant only). Optional: without SCRIBE_WEB_CLIENT_SECRET
 * the IdP registers no Scribe client and boots as before. The development
 * client is all-or-nothing and only ever redirects to a loopback origin.
 */
export const scribeEnvShape = {
	SCRIBE_WEB_URL: appWebUrl("https://scribe.hoandat.com"),
	SCRIBE_WEB_CLIENT_SECRET: appClientSecret.optional(),
	SCRIBE_MOBILE_REDIRECT_URI: appMobileRedirect(SCRIBE_MOBILE_REDIRECT_URI),
	/** Origin of a developer's local Scribe, e.g. http://localhost:5174. */
	SCRIBE_WEB_DEV_URL: appDevUrl,
	SCRIBE_WEB_DEV_CLIENT_SECRET: appClientSecret.optional(),
};

/** Reports a development client that is only partly configured. */
export function checkScribeDevGroup(
	env: {
		readonly SCRIBE_WEB_DEV_URL?: string;
		readonly SCRIBE_WEB_DEV_CLIENT_SECRET?: string;
	},
	ctx: z.RefinementCtx,
): void {
	checkDevPair(env, "SCRIBE_WEB_DEV_URL", "SCRIBE_WEB_DEV_CLIENT_SECRET", ctx);
}
