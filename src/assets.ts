import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
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

const CSS_DIR = `${STATIC_DIR}/css`;
const IMG_DIR = `${STATIC_DIR}/img`;
const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Short content hash of every stylesheet, read once at start (a deploy
 * restarts the process). It goes into the stylesheet URL, so new CSS never
 * meets a browser that cached the old file under the same address.
 */
const CSS_VERSIONS: ReadonlyMap<string, string> = new Map(
	readdirSync(CSS_DIR)
		.filter((name) => name.endsWith(".css"))
		.map((name) => [
			name,
			createHash("sha256")
				.update(readFileSync(`${CSS_DIR}/${name}`))
				.digest("hex")
				.slice(0, 12),
		]),
);

/** `/assets/css/<name>?v=<hash>` for a stylesheet in static/css. */
export function stylesheetHref(name: string): string {
	const version = CSS_VERSIONS.get(name);
	if (version === undefined) {
		throw new Error(`No stylesheet static/css/${name}`);
	}
	return `/assets/css/${name}?v=${version}`;
}

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
 * Stylesheets: the URL of the current version (?v=<its hash>) is cached for
 * a year; any other URL (no version, an old one) only for an hour.
 */
function cssRoute(): RequestHandler {
	const options = { index: false, fallthrough: false } as const;
	const current = express.static(CSS_DIR, {
		...options,
		immutable: true,
		maxAge: ONE_YEAR_SECONDS * 1000,
	});
	const other = express.static(CSS_DIR, { ...options, maxAge: ONE_HOUR_MS });
	return (req, res, next) => {
		const version = CSS_VERSIONS.get(req.path.slice(1));
		const route =
			version !== undefined && req.query.v === version ? current : other;
		route(req, res, next);
	};
}

/**
 * /assets: the token and page stylesheets, the guide's images, plus
 * self-hosted Inter and JetBrains Mono (each weight's CSS covers the
 * Vietnamese subset).
 */
export function createAssetsRouter(): Router {
	const router = Router();
	router.use("/fonts/inter", fontRoute(fontPackageDir("inter")));
	router.use(
		"/fonts/jetbrains-mono",
		fontRoute(fontPackageDir("jetbrains-mono")),
	);
	router.use("/css", cssRoute());
	// Guide screenshots: replaced in place when regenerated, so cached briefly.
	router.use(
		"/img",
		express.static(IMG_DIR, {
			index: false,
			fallthrough: false,
			maxAge: ONE_HOUR_MS,
		}),
	);
	return router;
}
