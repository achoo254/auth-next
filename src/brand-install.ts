import { fileURLToPath } from "node:url";
import { type RequestHandler, Router } from "express";
import { brand } from "./brand.js";
import { type SafeHtml, html } from "./ui/html.js";

/**
 * Repository-level `brand/` folder (icon SVGs, and generated/ written by
 * `pnpm brand:gen`). This module sits directly under src/, and the bundle is
 * dist/server.mjs, so "../brand" is the same folder in development and in a
 * release (infra/deploy.sh and the Dockerfile ship it next to static/).
 */
export const BRAND_DIR = fileURLToPath(new URL("../brand", import.meta.url));

export const MANIFEST_PATH = "manifest.webmanifest";
const APPLE_TOUCH_ICON = "apple-touch-icon.png";

/**
 * URL path (no leading slash) of each install file and its file under
 * brand/: the same list as `webIconFiles` of @achoo254/brand/build
 * (brand-install.test.ts keeps them equal), written out here so the server
 * bundle does not pull in the build-time half of the package.
 */
export const INSTALL_FILES: ReadonlyMap<string, string> = new Map([
	["icon.svg", "app-icon.svg"],
	["favicon.ico", "generated/icons/favicon.ico"],
	["icon-192.png", "generated/icons/icon-192.png"],
	["icon-512.png", "generated/icons/icon-512.png"],
	["icon-maskable-192.png", "generated/icons/icon-maskable-192.png"],
	["icon-maskable-512.png", "generated/icons/icon-maskable-512.png"],
	[APPLE_TOUCH_ICON, "generated/icons/apple-touch-icon.png"],
	[MANIFEST_PATH, "generated/web.webmanifest.json"],
]);

const CONTENT_TYPES: Record<string, string> = {
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".webmanifest": "application/manifest+json",
};

function contentType(path: string): string {
	return (
		CONTENT_TYPES[path.slice(path.lastIndexOf("."))] ??
		"application/octet-stream"
	);
}

/**
 * Serves the favicon, app icons and web manifest at the site root when
 * brand.config.json has "webInstall": true; otherwise nothing (falls
 * through). Icons are replaced in place by `pnpm brand:gen`, so they are
 * cached for an hour only.
 */
export function createBrandInstallRouter(
	webInstall: boolean = brand.webInstall,
): RequestHandler {
	const router = Router();
	if (!webInstall) return router;
	for (const [path, file] of INSTALL_FILES) {
		router.get(`/${path}`, (_req, res, next) => {
			res.sendFile(
				file,
				{
					root: BRAND_DIR,
					dotfiles: "deny",
					headers: {
						"content-type": contentType(path),
						"cache-control": "public, max-age=3600",
					},
				},
				(error) => {
					if (error) next(error);
				},
			);
		});
	}
	return router;
}

/** The head tags that make a page installable; empty while webInstall is off. */
export function brandHeadTags(
	webInstall: boolean = brand.webInstall,
): SafeHtml | string {
	if (!webInstall) return "";
	return html`<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/${APPLE_TOUCH_ICON}" sizes="180x180">
<link rel="manifest" href="/${MANIFEST_PATH}">
<meta name="theme-color" content="${brand.colors.primary ?? ""}">
<meta name="apple-mobile-web-app-title" content="${brand.shortName}">`;
}
