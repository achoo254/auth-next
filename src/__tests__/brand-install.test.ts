import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import {
	ICONS_DIR,
	ICONS_SOURCE_FILE,
	formatGenerated,
	generateManifests,
	iconSourceHashes,
	webIconFiles,
} from "@shared-next/brand/build";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	BRAND_GENERATED_DIR,
	BRAND_ROOT,
	MANIFEST_OPTIONS,
	loadAuthBrand,
} from "../../scripts/brand-options.js";
import {
	BRAND_DIR,
	INSTALL_FILES,
	MANIFEST_PATH,
	brandHeadTags,
	createBrandInstallRouter,
} from "../brand-install.js";
import { brand } from "../brand.js";

const config = loadAuthBrand();
const generated = (name: string): string =>
	readFileSync(new URL(name, BRAND_GENERATED_DIR), "utf8");

async function serve(webInstall: boolean): Promise<{
	base: string;
	close: () => Promise<void>;
}> {
	const app = express();
	app.use(createBrandInstallRouter(webInstall));
	app.use((_req, res) => {
		res.sendStatus(404);
	});
	const server = app.listen(0, "127.0.0.1");
	await new Promise<void>((resolve) => server.once("listening", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		base: `http://127.0.0.1:${port}`,
		close: () =>
			new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			),
	};
}

describe("brand install files", () => {
	it("is on in brand.config.json: the icons are designed", () => {
		expect(brand.webInstall).toBe(true);
	});

	it("serves the same files as @shared-next/brand lists, from brand/", () => {
		const expected = [
			...webIconFiles(config, {
				root: BRAND_ROOT,
				generatedDir: BRAND_GENERATED_DIR,
			}).map((icon) => [icon.path, icon.file.href] as const),
			[
				MANIFEST_PATH,
				new URL("web.webmanifest.json", BRAND_GENERATED_DIR).href,
			],
		];
		const served = [...INSTALL_FILES].map(
			([path, file]) =>
				[path, new URL(file, `file://${BRAND_DIR}/`).href] as const,
		);
		expect(served).toEqual(expected);
	});

	it("are generated from the current brand (run pnpm brand:gen after editing it)", () => {
		expect(generated("web.webmanifest.json")).toBe(
			formatGenerated(
				generateManifests(config, MANIFEST_OPTIONS)["web.webmanifest.json"],
				"\t",
			),
		);
		expect(JSON.parse(generated(`${ICONS_DIR}${ICONS_SOURCE_FILE}`))).toEqual(
			iconSourceHashes(config, BRAND_ROOT),
		);
	});
});

describe("createBrandInstallRouter", () => {
	let on: Awaited<ReturnType<typeof serve>>;
	let off: Awaited<ReturnType<typeof serve>>;
	beforeAll(async () => {
		on = await serve(true);
		off = await serve(false);
	});
	afterAll(async () => {
		await on?.close();
		await off?.close();
	});

	it.each([
		["icon.svg", "image/svg+xml"],
		["favicon.ico", "image/x-icon"],
		["icon-192.png", "image/png"],
		["icon-maskable-512.png", "image/png"],
		["apple-touch-icon.png", "image/png"],
		[MANIFEST_PATH, "application/manifest+json"],
	])("on: serves /%s as %s", async (path, type) => {
		const answer = await fetch(`${on.base}/${path}`);
		expect(answer.status).toBe(200);
		expect(answer.headers.get("content-type")).toBe(type);
		expect(answer.headers.get("cache-control")).toBe("public, max-age=3600");
		expect((await answer.arrayBuffer()).byteLength).toBeGreaterThan(0);
	});

	it("on: the manifest names the brand and its icons", async () => {
		const manifest: unknown = await (
			await fetch(`${on.base}/${MANIFEST_PATH}`)
		).json();
		expect(manifest).toMatchObject({
			name: brand.appName,
			start_url: "/",
			display: "standalone",
		});
	});

	it("off: serves nothing", async () => {
		expect((await fetch(`${off.base}/favicon.ico`)).status).toBe(404);
		expect((await fetch(`${off.base}/${MANIFEST_PATH}`)).status).toBe(404);
	});
});

describe("brandHeadTags", () => {
	it("links the favicon, touch icon and manifest when on, nothing when off", () => {
		const tags = String(brandHeadTags(true));
		expect(tags).toContain('<link rel="icon" href="/favicon.ico"');
		expect(tags).toContain(
			'<link rel="icon" href="/icon.svg" type="image/svg+xml">',
		);
		expect(tags).toContain(
			'<link rel="apple-touch-icon" href="/apple-touch-icon.png"',
		);
		expect(tags).toContain(`<link rel="manifest" href="/${MANIFEST_PATH}">`);
		expect(String(brandHeadTags(false))).toBe("");
	});
});
