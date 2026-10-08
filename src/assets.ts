import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type RequestHandler, Router } from "express";

/**
 * Repository-level `static/` folder. This module sits directly under src/,
 * and the bundle is dist/server.mjs, so "../static" resolves to the same
 * folder in development (tsx) and in the built image.
 */
export const STATIC_DIR = fileURLToPath(new URL("../static", import.meta.url));

const require = createRequire(import.meta.url);

/** Directory of an installed @fontsource package. */
function fontPackageDir(name: string): string {
	return dirname(require.resolve(`@fontsource/${name}/package.json`));
}

const FONT_FILE = /^\/(?:[1-9]00\.css|files\/[a-z0-9-]+\.woff2?)$/;
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** Only the weight stylesheets and font files of a font package. */
function fontRoute(directory: string): RequestHandler {
	const serve = express.static(directory, {
		index: false,
		fallthrough: false,
		immutable: true,
		maxAge: ONE_YEAR_SECONDS * 1000,
	});
	return (req, res, next) => {
		if (!FONT_FILE.test(req.path)) {
			res.sendStatus(404);
			return;
		}
		serve(req, res, next);
	};
}

/**
 * /assets: the token and page stylesheets, plus self-hosted Inter and
 * JetBrains Mono (each weight's CSS covers the Vietnamese subset).
 */
export function createAssetsRouter(): Router {
	const router = Router();
	router.use("/fonts/inter", fontRoute(fontPackageDir("inter")));
	router.use(
		"/fonts/jetbrains-mono",
		fontRoute(fontPackageDir("jetbrains-mono")),
	);
	router.use(
		"/css",
		express.static(`${STATIC_DIR}/css`, {
			index: false,
			fallthrough: false,
			maxAge: 60 * 60 * 1000,
		}),
	);
	return router;
}
