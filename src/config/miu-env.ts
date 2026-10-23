import type { z } from "zod";
import { MIU_MOBILE_REDIRECT_URI } from "../oidc/miu-clients.js";
import {
	appClientSecret,
	appDevUrl,
	appMobileRedirect,
	appWebUrl,
	checkDevPair,
} from "./primary-app-env.js";

/**
 * Miu World (primary tenant only). Optional: without MIU_WEB_CLIENT_SECRET
 * the IdP registers no Miu client and boots as before. The development
 * client is all-or-nothing and only ever redirects to a loopback origin.
 */
export const miuEnvShape = {
	MIU_WEB_URL: appWebUrl("https://miu.hoandat.com"),
	MIU_WEB_CLIENT_SECRET: appClientSecret.optional(),
	MIU_MOBILE_REDIRECT_URI: appMobileRedirect(MIU_MOBILE_REDIRECT_URI),
	/** Origin of a developer's local Miu World, e.g. http://localhost:5173. */
	MIU_WEB_DEV_URL: appDevUrl,
	MIU_WEB_DEV_CLIENT_SECRET: appClientSecret.optional(),
};

/** Reports a development client that is only partly configured. */
export function checkMiuDevGroup(
	env: {
		readonly MIU_WEB_DEV_URL?: string;
		readonly MIU_WEB_DEV_CLIENT_SECRET?: string;
	},
	ctx: z.RefinementCtx,
): void {
	checkDevPair(env, "MIU_WEB_DEV_URL", "MIU_WEB_DEV_CLIENT_SECRET", ctx);
}
