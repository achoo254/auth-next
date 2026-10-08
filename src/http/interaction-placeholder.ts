import type { RequestHandler } from "express";

export const INTERACTION_PLACEHOLDER_MESSAGE =
	"Sign-in is not available yet: the login UI arrives in phase 02.";

/**
 * Stands in for the login, consent and device-approval pages until they
 * exist. Every interaction ends here with 501, so no request can complete an
 * authorization outside the test harness.
 */
export const interactionPlaceholder: RequestHandler = (_req, res) => {
	res
		.status(501)
		.type("text/plain")
		.set("cache-control", "no-store")
		.send(INTERACTION_PLACEHOLDER_MESSAGE);
};
