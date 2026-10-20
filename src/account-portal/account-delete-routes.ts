import type { RequestHandler, Router } from "express";
import { normalizeUsername } from "../accounts/user-model.js";
import { formText } from "../http/form.js";
import type { AppServices } from "../services.js";
import { pageContext } from "../ui/page-context.js";
import { sendPage } from "../ui/send-page.js";
import {
	ACCOUNT_DELETED_PATH,
	ACCOUNT_DELETE_PATH,
	renderAccountDeleted,
	renderDeleteConfirm,
} from "./account-delete-page.js";
import { deleteAccount } from "./account-deletion.js";
import { type PortalHandler, portalCsrfScope } from "./portal-session.js";

type Wrap = (handler: PortalHandler) => RequestHandler;

const routerPath = ACCOUNT_DELETE_PATH.replace(/^\/account/, "");

/**
 * Deleting one's own account (ADR 0009): GET asks, POST deletes. POST is
 * `sensitive` (CSRF and a sign-in within 10 minutes) and also needs the
 * username typed again.
 */
export function registerDeleteRoutes(
	router: Router,
	services: AppServices,
	page: Wrap,
	sensitive: Wrap,
): void {
	router.get(
		routerPath,
		page(async (req, res, portal) => {
			sendPage(
				res,
				renderDeleteConfirm({
					host: services.host,
					page: pageContext(req),
					csrf: services.csrf.token(req, res, portalCsrfScope(portal)),
					username: portal.account.username,
					mentionDomains: services.tenancy !== undefined,
				}),
			);
		}),
	);

	// Public: the session it would need is gone with the account.
	router.get(ACCOUNT_DELETED_PATH.replace(/^\/account/, ""), (req, res) => {
		sendPage(res, renderAccountDeleted(services.host, pageContext(req)));
	});

	router.post(
		routerPath,
		sensitive(async (req, res, { account }) => {
			const typed = normalizeUsername(
				formText(req, "username", 100).replace(/^@/, ""),
			);
			if (typed !== account.username) {
				res.redirect(303, "/account?notice=delete-mismatch");
				return;
			}
			// A second click finds the account disabled and ends here too.
			await deleteAccount(services, account._id, "web");
			res.redirect(303, ACCOUNT_DELETED_PATH);
		}),
	);
}
