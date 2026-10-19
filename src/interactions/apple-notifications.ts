import express, { type Router } from "express";
import { isAppleUpstream } from "../accounts/upstream-apple.js";
import { formRateLimit } from "../http/form.js";
import type { AppServices } from "../services.js";
import { asyncHandler } from "./interaction-helpers.js";

/** Where Apple posts account events; entered in Apple's developer portal. */
export const APPLE_NOTIFICATIONS_PATH = "/apple/notifications";

/** Events after which Apple no longer honours the stored refresh token. */
const TOKEN_ENDING_EVENTS: ReadonlySet<string> = new Set([
	"consent-revoked",
	"account-deleted",
]);

function payloadOf(body: unknown): string | undefined {
	if (typeof body !== "object" || body === null) return undefined;
	const payload: unknown = Reflect.get(body, "payload");
	return typeof payload === "string" && payload.length <= 8192
		? payload
		: undefined;
}

/**
 * Sign in with Apple server-to-server notifications (`{ "payload": JWS }`),
 * checked against Apple's keys. Consent revoked or Apple account deleted:
 * the stored refresh token is dropped, since Apple already invalidated it;
 * the link stays, so the account never loses its last way in silently, and
 * the person sees it on /account. Email forwarding changes need nothing:
 * the IdP sends no email. Every event is logged without its subject.
 */
export function registerAppleNotifications(
	router: Router,
	services: AppServices,
): void {
	router.post(
		APPLE_NOTIFICATIONS_PATH,
		formRateLimit(120),
		express.json({ limit: "16kb" }),
		asyncHandler(async (req, res) => {
			const apple = services.upstreams.get("apple");
			if (!isAppleUpstream(apple)) {
				res.sendStatus(404);
				return;
			}
			const payload = payloadOf(req.body);
			if (!payload) {
				res.sendStatus(400);
				return;
			}
			let event: Awaited<ReturnType<typeof apple.verifyNotification>>;
			try {
				event = await apple.verifyNotification(payload);
			} catch (error) {
				services.logger.warn(
					{ reason: error instanceof Error ? error.name : "unknown" },
					"Apple notification rejected",
				);
				res.sendStatus(400);
				return;
			}
			const account = await services.accounts.findByProvider(
				"apple",
				event.sub,
			);
			const forgot = TOKEN_ENDING_EVENTS.has(event.type)
				? await services.accounts.forgetRevocationToken("apple", event.sub)
				: false;
			services.logger.info(
				{ type: event.type, accountId: account?._id, forgot },
				"Apple account event",
			);
			res.sendStatus(200);
		}),
	);
}
