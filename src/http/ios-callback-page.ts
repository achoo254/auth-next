import { type Request, type Response, Router } from "express";
import {
	IOS_CALLBACK_PATH,
	IOS_LINKED_PATH,
} from "../oidc/account-ios-client.js";
import { pageTitle } from "../ui/components.js";
import { html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { pageContext } from "../ui/page-context.js";
import { sendPage } from "../ui/send-page.js";

/**
 * /ios/callback and /ios/linked are the app's universal links: the app
 * takes them over before a request is made. Opened in a browser instead,
 * they only say to go back to the app; the code or result in the query is
 * never read, never sent anywhere (no-referrer) and never cached.
 */
export function createIosCallbackRouter(host: string): Router {
	const router = Router();
	const page = (req: Request, res: Response): void => {
		// The language switcher returns to the bare path: the query (a code)
		// never goes into the page.
		const context = { ...pageContext(req), path: req.path };
		const title = context.i18n.t("iosApp.open.title");
		res.set("referrer-policy", "no-referrer");
		sendPage(
			res,
			renderPage({
				title,
				host,
				page: context,
				body: pageTitle(
					html`<span data-id="ios-open-app">${title}</span>`,
					context.i18n.t("iosApp.open.body"),
				),
			}),
		);
	};
	router.get(IOS_CALLBACK_PATH, page);
	router.get(IOS_LINKED_PATH, page);
	return router;
}
