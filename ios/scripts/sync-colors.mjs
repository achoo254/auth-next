// Regenerates the Brand* colour sets of the iOS app from the web tokens
// (static/css/tokens.css: block [1] light, block [2] dark), so app and
// web share one palette. Run from the repo root:
//   node ios/scripts/sync-colors.mjs && pnpm exec biome format --write ios
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TOKENS = join(ROOT, "static/css/tokens.css");
const ASSETS = join(ROOT, "ios/AccountApp/Resources/Assets.xcassets");

/** Colour set name → CSS custom property. */
const COLORS = {
	BrandBackground: "--c-bg",
	BrandSurface: "--c-surface",
	BrandText: "--c-text",
	BrandTextMuted: "--c-text-muted",
	BrandBorder: "--c-border",
	BrandPrimary: "--c-primary",
	BrandPrimarySolid: "--c-primary-solid",
	BrandOnPrimary: "--c-on-primary",
	BrandSuccess: "--c-success",
	BrandWarning: "--c-warning",
	BrandError: "--c-error",
	BrandInfo: "--c-info",
	BrandOnTone: "--c-on-tone",
	// The tint of controls, links and the launch screen accent.
	AccentColor: "--c-primary",
};

function block(css, marker) {
	const start = css.indexOf(marker);
	if (start < 0) throw new Error(`tokens.css: block ${marker} not found`);
	const open = css.indexOf("{", css.indexOf("\n", start));
	const close = css.indexOf("}", open);
	return css.slice(open, close);
}

function hexOf(source, property) {
	const match = source.match(
		new RegExp(`${property}:\\s*(#[0-9a-fA-F]{6})\\b`),
	);
	if (!match) throw new Error(`tokens.css: ${property} has no #rrggbb value`);
	return match[1];
}

function components(hex) {
	const byte = (offset) => `0x${hex.slice(offset, offset + 2).toUpperCase()}`;
	return { alpha: "1.000", blue: byte(5), green: byte(3), red: byte(1) };
}

function colorSet(light, dark) {
	const entry = (hex, appearances) => ({
		...(appearances ? { appearances } : {}),
		color: { "color-space": "srgb", components: components(hex) },
		idiom: "universal",
	});
	return {
		colors: [
			entry(light),
			entry(dark, [{ appearance: "luminosity", value: "dark" }]),
		],
		info: { author: "xcode", version: 1 },
	};
}

const css = await readFile(TOKENS, "utf8");
const light = block(css, "/* [1]");
const dark = block(css, "@media (prefers-color-scheme: dark)");
for (const [name, property] of Object.entries(COLORS)) {
	const dir = join(ASSETS, `${name}.colorset`);
	await mkdir(dir, { recursive: true });
	const set = colorSet(hexOf(light, property), hexOf(dark, property));
	await writeFile(
		join(dir, "Contents.json"),
		`${JSON.stringify(set, null, "\t")}\n`,
	);
}
console.log(`Wrote ${Object.keys(COLORS).length} colour sets to ${ASSETS}`);
