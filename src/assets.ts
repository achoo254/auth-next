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
 * Files of @achoo254/app-shell served as they ship: its design tokens, the
 * stylesheet of the shared header and footer, and the script that runs the
 * theme switch before the first paint (no inline script under the CSP).
 */
export const APP_SHELL_FILES = [
	"tokens.css",
	"app-shell.css",
	"app-shell-enhance.js",
] as const;
export type AppShellFile = (typeof APP_SHELL_FILES)[number];

const APP_SHELL_DIR = dirname(
	require.resolve("@achoo254/app-shell/app-shell-enhance.js"),
);

/** Short content hash of a file, read once at start (a deploy restarts the process). */
function contentHash(path: string): string {
	return createHash("sha256")
		.update(readFileSync(path))
		.digest("hex")
		.slice(0, 12);
}

/**
 * Content hash of every stylesheet. It goes into the URL, so new CSS never
 * meets a browser that cached the old file under the same address.
 */
const CSS_VERSIONS: ReadonlyMap<string, string> = new Map(
	readdirSync(CSS_DIR)
		.filter((name) => name.endsWith(".css"))
		.map((name) => [name, contentHash(`${CSS_DIR}/${name}`)]),
);

const APP_SHELL_VERSIONS: ReadonlyMap<string, string> = new Map(
	APP_SHELL_FILES.map((name) => [
		name,
		contentHash(`${APP_SHELL_DIR}/${name}`),
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

/** `/assets/app-shell/<name>?v=<hash>` for a file of the shared shell. */
export function appShellHref(name: AppShellFile): string {
	return `/assets/app-shell/${name}?v=${APP_SHELL_VERSIONS.get(name) ?? ""}`;
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
 * Files named by content hash: the URL of the current version (?v=<its
 * hash>) is cached for a year; any other URL (no version, an old one) only
 * for an hour. Names outside `versions` are 404.
 */
function versionedRoute(
	directory: string,
	versions: ReadonlyMap<string, string>,
): RequestHandler {
	const options = { index: false, fallthrough: false } as const;
	const current = express.static(directory, {
		...options,
		immutable: true,
		maxAge: ONE_YEAR_SECONDS * 1000,
	});
	const other = express.static(directory, { ...options, maxAge: ONE_HOUR_MS });
	return (req, res, next) => {
		const version = versions.get(req.path.slice(1));
		if (version === undefined) {
			res.sendStatus(404);
			return;
		}
		const route = req.query.v === version ? current : other;
		route(req, res, next);
	};
}

/**
 * /assets: the page stylesheets, the shared shell's files, the guide's images, plus
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
	router.use("/css", versionedRoute(CSS_DIR, CSS_VERSIONS));
	router.use("/app-shell", versionedRoute(APP_SHELL_DIR, APP_SHELL_VERSIONS));
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
