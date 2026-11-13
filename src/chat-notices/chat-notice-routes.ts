import { Router } from "express";
import { portalRoute } from "../account-portal/portal-session.js";
import { formRateLimit, parseForm } from "../http/form.js";
import type { AppServices } from "../services.js";
import { pageContext } from "../ui/page-context.js";

/** Paths of the /account switch for security notices through Chat. */
export const CHAT_NOTICES_PATH = "/account/chat-notices";

/**
 * /account/chat-notices/on and /off (ADR 0017). Both are security changes
 * (off is what hiding an intrusion would do): CSRF and a recent sign-in.
 * Answers 404 while the channel is off (CHAT_NOTICES_URL unset).
 */
export function createChatNoticeRouter(services: AppServices): Router {
	const router = Router();
	if (!services.chatNotices) {
		router.use((_req, res) => {
			res.sendStatus(404);
		});
		return router;
	}
	router.post("/*splat", formRateLimit(services.formPostsPerMinute), parseForm);
	router.post(
		"/on",
		portalRoute(
			services,
			async (req, res, { account }) => {
				// Notices speak the language of the page they were turned on from.
				const { locale } = pageContext(req).i18n;
				await services.accounts.links.setChatNotices(account._id, locale);
				res.redirect(303, "/account?notice=chat-notices-on");
			},
			{ csrf: true, recentLogin: true },
		),
	);
	router.post(
		"/off",
		portalRoute(
			services,
			async (_req, res, { account }) => {
				await services.accounts.links.setChatNotices(account._id, undefined);
				res.redirect(303, "/account?notice=chat-notices-off");
			},
			{ csrf: true, recentLogin: true },
		),
	);
	return router;
}
