import { type RequestHandler, Router } from "express";
import {
	IOS_CALLBACK_PATH,
	IOS_LINKED_PATH,
} from "../oidc/account-ios-client.js";

export const AASA_PATH = "/.well-known/apple-app-site-association";

/** The /ios/* paths the app opens as universal links. */
const IOS_PATHS = [IOS_CALLBACK_PATH, IOS_LINKED_PATH];

/**
 * apple-app-site-association of the issuer (primary tenant): the app
 * `appId` (`<TEAMID>.<bundle id>`) opens /ios/callback and /ios/linked
 * (`applinks`, the sign-in callback of ASWebAuthenticationSession's https
 * callback) and is associated for `webcredentials`. Served as JSON at the
 * exact path, never through a redirect, as Apple's CDN requires.
 */
export function appleAppSiteAssociation(appId: string): object {
	return {
		applinks: {
			details: [
				{
					appIDs: [appId],
					components: IOS_PATHS.map((path) => ({ "/": path })),
				},
			],
		},
		webcredentials: { apps: [appId] },
	};
}

/** Serves the file when `appId` is configured; 404 (falls through) otherwise. */
export function createAasaRouter(appId: string | undefined): RequestHandler {
	const router = Router();
	if (!appId) return router;
	const body = JSON.stringify(appleAppSiteAssociation(appId));
	router.get(AASA_PATH, (_req, res) => {
		res
			.status(200)
			.type("application/json")
			.set("cache-control", "public, max-age=3600")
			.send(body);
	});
	return router;
}
