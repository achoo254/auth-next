import { z } from "zod";
import { SCRIBE_MOBILE_REDIRECT_URI } from "../oidc/scribe-clients.js";
import {
	appClientSecret,
	appDevUrl,
	appMobileRedirect,
	appWebUrl,
	checkDevPair,
} from "./primary-app-env.js";

/**
 * Scribe on the primary tenant, and on registry tenants once enabled.
 * Optional: without SCRIBE_WEB_CLIENT_SECRET the primary tenant registers
 * no Scribe client and boots as before. The development client is
 * all-or-nothing and only ever redirects to a loopback origin.
 */
export const scribeEnvShape = {
	SCRIBE_WEB_URL: appWebUrl("https://scribe.hoandat.com"),
	SCRIBE_WEB_CLIENT_SECRET: appClientSecret.optional(),
	SCRIBE_MOBILE_REDIRECT_URI: appMobileRedirect(SCRIBE_MOBILE_REDIRECT_URI),
	/** Origin of a developer's local Scribe, e.g. http://localhost:5174. */
	SCRIBE_WEB_DEV_URL: appDevUrl,
	SCRIBE_WEB_DEV_CLIENT_SECRET: appClientSecret.optional(),
	/**
	 * Scribe on registry tenants (ADR 0012): off by default. With it on and
	 * SCRIBE_SEALING_PUBLIC_KEY_PATH set, owners add AI keys at /admin and a
	 * tenant with a transcription key gets `scribe-web` and `scribe.<d>`.
	 */
	SCRIBE_TENANTS: z
		.enum(["true", "false", "1", "0"], { error: "must be true or false" })
		.default("false")
		.transform((value) => value === "true" || value === "1"),
	/** PEM of Scribe's RSA public key (≥ 3072 bits): AI keys are sealed to it. */
	SCRIBE_SEALING_PUBLIC_KEY_PATH: z.string().min(1).optional(),
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
