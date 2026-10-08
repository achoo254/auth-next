import { type RequestHandler, Router } from "express";
import { hashSecret, passwordProblem } from "../accounts/password-hasher.js";
import { generateRecoveryCodes } from "../accounts/recovery-codes.js";
import {
	formRateLimit,
	formText,
	formValue,
	parseForm,
	queryValue,
} from "../http/form.js";
import {
	asyncHandler,
	sendInteractionError,
} from "../interactions/interaction-helpers.js";
import {
	checkPassword,
	throttleSubject,
} from "../interactions/login-handler.js";
import { renderRecoveryCodes } from "../interactions/signup-page.js";
import type { AppServices } from "../services.js";
import { notifyTelegram } from "../telegram/notify.js";
import { sendPage } from "../ui/send-page.js";
import { registerAccessRoutes } from "./account-access-routes.js";
import { renderAccountPage } from "./account-page.js";
import { afterPasswordChange } from "./after-password-change.js";
import {
	listAuthorizedApps,
	listDeviceGrants,
	listGrants,
} from "./grant-directory.js";
import {
	type PortalHandler,
	consumeReauthState,
	portalCsrfScope,
	portalRoute,
} from "./portal-session.js";
import { listSessions } from "./session-directory.js";

/** /account: the signed-in user's own account page and its actions. */
export function createAccountRouter(services: AppServices): Router {
	const router = Router();
	const write = (handler: PortalHandler): RequestHandler =>
		portalRoute(services, handler, { csrf: true });
	const sensitive = (handler: PortalHandler): RequestHandler =>
		portalRoute(services, handler, { csrf: true, recentLogin: true });
	router.post("/*splat", formRateLimit(services.formPostsPerMinute), parseForm);

	router.get(
		"/",
		portalRoute(
			services,
			async (req, res, portal) => {
				const { account } = portal;
				const grants = await listGrants(services.db, account._id);
				const [sessions, devices, apps] = await Promise.all([
					listSessions(services.db, account._id),
					listDeviceGrants(services.db, grants),
					listAuthorizedApps(services.provider, grants),
				]);
				sendPage(
					res,
					renderAccountPage({
						host: services.host,
						csrf: services.csrf.token(req, res, portalCsrfScope(portal)),
						account,
						currentSessionUid: portal.sessionUid,
						providers: [...services.upstreams.keys()],
						telegramEnabled: services.telegram !== undefined,
						sessions,
						devices,
						apps,
						notice: queryValue(req, "notice"),
					}),
				);
			},
			{ csrf: false },
		),
	);

	// The portal client's redirect URI: the session cookie is set by now.
	router.get(
		"/callback",
		asyncHandler(async (req, res) => {
			if (queryValue(req, "error")) {
				sendInteractionError(
					services,
					res,
					"Chưa đăng nhập được vào trang tài khoản.",
					400,
					{ href: "/account", label: "Thử lại" },
				);
				return;
			}
			const reauthed = consumeReauthState(
				services,
				req,
				res,
				queryValue(req, "state") ?? "",
			);
			res.redirect(303, reauthed ? "/account?notice=reauthed" : "/account");
		}),
	);

	router.post(
		"/profile",
		write(async (req, res, { account }) => {
			const name = formText(req, "name", 100);
			await services.accounts.updateName(account._id, name || undefined);
			res.redirect(303, "/account?notice=profile");
		}),
	);

	router.post(
		"/password",
		sensitive(async (req, res, { account, sessionUid }) => {
			const password = formValue(req, "password") ?? "";
			if (
				passwordProblem(password) ||
				password !== formValue(req, "password_confirm")
			) {
				res.redirect(303, "/account?notice=password-invalid");
				return;
			}
			if (account.passwordHash) {
				const check = await checkPassword(
					services.passwordThrottle,
					throttleSubject(services, req, account._id, account),
					account,
					formValue(req, "current_password") ?? "",
				);
				if (!check.ok) {
					res.redirect(
						303,
						`/account?notice=${check.reason === "locked" ? "password-locked" : "password-wrong"}`,
					);
					return;
				}
			}
			await services.accounts.setPassword(
				account._id,
				await hashSecret(password),
			);
			// Other browsers are signed out; with the box ticked (the default)
			// every device and app loses its grant too.
			await afterPasswordChange(services, account, "account-page", {
				exceptSessionUid: sessionUid,
				grants: formValue(req, "logout_everywhere") === "yes",
			});
			res.redirect(303, "/account?notice=password");
		}),
	);

	router.post(
		"/recovery-codes",
		sensitive(async (req, res, portal) => {
			const recovery = await generateRecoveryCodes();
			await services.accounts.replaceRecoveryCodes(
				portal.account._id,
				recovery.hashes,
			);
			services.logger.info(
				{ accountId: portal.account._id },
				"Recovery codes regenerated",
			);
			notifyTelegram(
				services,
				portal.account,
				`Bộ mã khôi phục mới vừa được tạo cho tài khoản hoandat @${portal.account.username}; bộ cũ hết hiệu lực. Nếu không phải bạn, hãy đổi mật khẩu ngay.`,
			);
			sendPage(
				res,
				renderRecoveryCodes({
					host: services.host,
					csrf: services.csrf.token(req, res, portalCsrfScope(portal)),
					action: "/account/recovery-codes/saved",
					username: portal.account.username,
					codes: recovery.codes,
					continueLabel: "Về trang tài khoản",
					intro:
						"Bộ mã cũ đã hết hiệu lực. Mỗi mã dưới đây dùng được một lần để đặt lại mật khẩu.",
				}),
			);
		}),
	);

	router.post(
		"/recovery-codes/saved",
		write(async (_req, res) => {
			res.redirect(303, "/account?notice=codes");
		}),
	);

	registerAccessRoutes(router, services, write, sensitive);
	return router;
}
