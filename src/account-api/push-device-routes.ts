import type { Router } from "express";
import { z } from "zod";
import { DEFAULT_LOCALE, isLocale, matchLocale } from "../i18n/locales.js";
import { GRANT_IDLE_SECONDS } from "../oidc/sliding-grants.js";
import { APNS_ENVIRONMENTS } from "../push/push-devices.js";
import type { AppServices } from "../services.js";
import { apiRoute, sendApiError } from "./bearer-auth.js";

const registration = z.object({
	/** APNs device tokens are hex; Apple documents no fixed length. */
	token: z.string().regex(/^[0-9a-fA-F]{64,200}$/),
	environment: z.enum(APNS_ENVIRONMENTS),
	/** BCP 47 tag of the phone's language, e.g. "vi-VN"; English otherwise. */
	locale: z.string().max(35).optional(),
});

/**
 * PUT /api/account/push-device registers this phone's APNs token for the
 * grant of the access token (so it dies with that grant); DELETE forgets
 * it (the app calls it before signing out). Both answer 204. Without
 * APNS_* configured, PUT stores nothing (no token kept for a feature that
 * is off).
 */
export function registerPushDeviceRoutes(
	router: Router,
	services: AppServices,
): void {
	router.put(
		"/push-device",
		apiRoute(async (req, res, { account, grantId }) => {
			const body = registration.safeParse(req.body);
			if (!body.success) {
				sendApiError(
					res,
					400,
					"invalid_request",
					"token (hex) and environment (sandbox or production) are required",
				);
				return;
			}
			if (!services.pushSender) {
				res.status(204).end();
				return;
			}
			const grant = await services.provider.Grant.find(grantId);
			const exp =
				grant?.exp ?? Math.floor(Date.now() / 1000) + GRANT_IDLE_SECONDS;
			const tag = body.data.locale;
			const locale =
				(tag && (isLocale(tag) ? tag : matchLocale(tag))) || DEFAULT_LOCALE;
			await services.pushDevices.register({
				accountId: account._id,
				grantId,
				token: body.data.token.toLowerCase(),
				environment: body.data.environment,
				locale,
				expiresAt: new Date(exp * 1000),
			});
			res.status(204).end();
		}),
	);

	router.delete(
		"/push-device",
		apiRoute(async (_req, res, { grantId }) => {
			await services.pushDevices.removeGrants([grantId]);
			res.status(204).end();
		}),
	);
}
