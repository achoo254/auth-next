import type { Router } from "express";
import { z } from "zod";
import { isUpstreamProvider } from "../accounts/user-model.js";
import { routeParam } from "../http/form.js";
import { completeAppLink } from "../interactions/app-link-result.js";
import type { AppServices } from "../services.js";
import { accountLimit } from "./account-api-limits.js";
import { apiRoute, sendApiError } from "./bearer-auth.js";

const completeBody = z.object({ ref: z.string().min(1).max(128) });

/**
 * POST /api/account/providers/:provider/link/complete `{ "ref" }`: the app
 * confirms the provider its own browser sheet went through. Bearer of the
 * same app grant that started the link (re-authenticated then); a `ref`
 * of another grant, account or provider, used or expired, is `not_found`.
 * Answers 200 `{ "result" }` (app-link-result.ts).
 */
export function registerAppLinkRoutes(
	router: Router,
	services: AppServices,
): void {
	router.post(
		"/providers/:provider/link/complete",
		accountLimit(services.accountApiLimits.sensitivePerAccount),
		apiRoute(async (req, res, api) => {
			const provider = routeParam(req, "provider");
			const body = completeBody.safeParse(req.body);
			if (!isUpstreamProvider(provider) || !body.success) {
				sendApiError(res, 404, "not_found");
				return;
			}
			const result = await completeAppLink(
				services,
				{ accountId: api.account._id, grantId: api.grantId },
				provider,
				body.data.ref,
			);
			if (!result) {
				sendApiError(res, 404, "not_found");
				return;
			}
			res.set("cache-control", "no-store").json({ result });
		}),
	);
}
