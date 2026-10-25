import { z } from "zod";
import { appClientSecret, checkDevPair } from "./primary-app-env.js";

/**
 * Tiểu Đệ (primary tenant only). Optional and all-or-nothing: the IdP
 * registers the `tieude-web` client only when both its origin and its
 * client secret are set, and boots as before when neither is.
 */
export const tieudeEnvShape = {
	/** Origin of Tiểu Đệ, e.g. https://tieude.hoandat.com. */
	TIEUDE_WEB_URL: z
		.url({ protocol: /^https?$/, error: "must be an http(s) URL" })
		.optional(),
	TIEUDE_WEB_CLIENT_SECRET: appClientSecret.optional(),
};

/** Reports a Tiểu Đệ client of which only the URL or the secret is set. */
export function checkTieudeGroup(
	env: {
		readonly TIEUDE_WEB_URL?: string;
		readonly TIEUDE_WEB_CLIENT_SECRET?: string;
	},
	ctx: z.RefinementCtx,
): void {
	checkDevPair(env, "TIEUDE_WEB_URL", "TIEUDE_WEB_CLIENT_SECRET", ctx);
}
