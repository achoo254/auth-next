import type { Router } from "express";
import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import { isUpstreamProvider } from "../accounts/user-model.js";
import {
	formRateLimit,
	formValue,
	parseForm,
	routeParam,
} from "../http/form.js";
import type { AppServices } from "../services.js";
import { asyncHandler, sendInteractionError } from "./interaction-helpers.js";

/** Long enough for the browser to follow one redirect. */
const FORM_POST_TTL_SECONDS = 2 * 60;

/** Our states are `randomToken()`: 32 bytes, base64url. */
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The fields kept from a provider's form_post, with their size limits. */
const FIELDS: readonly (readonly [string, number])[] = [
	["code", 2048],
	// Apple: name and email as JSON, on the first authorization only.
	["user", 4096],
	["error", 128],
];

/**
 * The callback of a form_post provider (Apple). The POST comes from the
 * provider's page, cross-site, so the SameSite=Lax state cookie is not
 * sent with it and the state cannot be checked here. Its fields are kept
 * server-side for two minutes under the state, and the browser is sent
 * on to the same path as a GET: a top-level same-method-safe navigation,
 * which carries the cookie, so the usual state check runs there. Nothing
 * of the answer but the state appears in the URL.
 */
export function registerFormPostCallback(
	router: Router,
	services: AppServices,
): void {
	router.post(
		"/:provider/callback",
		// Each answer stores a document: budget it like a form post.
		formRateLimit(services.formPostsPerMinute),
		parseForm,
		asyncHandler(async (req, res) => {
			const name = routeParam(req, "provider");
			const client = isUpstreamProvider(name)
				? services.upstreams.get(name)
				: undefined;
			if (!client || client.responseMode !== "form_post") {
				res.sendStatus(404);
				return;
			}
			const state = formValue(req, "state") ?? "";
			if (!STATE_PATTERN.test(state)) {
				sendInteractionError(services, res, {
					message: "upstream.expired",
					params: { provider: UPSTREAM_LABELS[client.provider] },
					status: 410,
				});
				return;
			}
			const fields: Record<string, string> = {};
			for (const [field, maxLength] of FIELDS) {
				const value = formValue(req, field);
				if (value !== undefined && value.length <= maxLength) {
					fields[field] = value;
				}
			}
			await services.tokens.put(
				"upstream-form-post",
				state,
				fields,
				FORM_POST_TTL_SECONDS,
			);
			res.redirect(
				303,
				`/oauth/${client.provider}/callback?state=${encodeURIComponent(state)}`,
			);
		}),
	);
}

/** Uses up the form a provider posted for `state`, as callback parameters. */
export async function takeFormPost(
	services: AppServices,
	state: string,
): Promise<URLSearchParams | undefined> {
	const fields = await services.tokens.take("upstream-form-post", state);
	return fields ? new URLSearchParams({ ...fields, state }) : undefined;
}
