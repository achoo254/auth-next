/**
 * `pnpm brand:gen`: validates brand.config.json against the @shared-next/brand
 * schema and writes brand/generated/: the web manifest and the PNG/ICO icons
 * drawn from brand/app-icon.svg and app-icon-maskable.svg with the Chromium
 * of @playwright/test. src/brand-install.ts serves them at the site root when
 * "webInstall" is on. Run after editing the brand, then commit the files.
 * The iOS app icon is not generated here (ios/scripts/render-app-icon.swift).
 */
import { chromium } from "@playwright/test";
import { chromiumRenderer, writeBrandFiles } from "@shared-next/brand/build";
import {
	BRAND_GENERATED_DIR,
	BRAND_ROOT,
	MANIFEST_OPTIONS,
	loadAuthBrand,
} from "./brand-options.js";

async function main(): Promise<void> {
	const written = await writeBrandFiles({
		brand: loadAuthBrand(),
		root: BRAND_ROOT,
		generatedDir: BRAND_GENERATED_DIR,
		manifests: MANIFEST_OPTIONS,
		indent: "\t",
		renderer: chromiumRenderer(chromium),
	});
	process.stdout.write(
		`Wrote ${written.length} files to ${BRAND_GENERATED_DIR.pathname}: ${written.join(", ")}\n`,
	);
}

main().catch((error: unknown) => {
	process.stderr.write(`brand:gen failed: ${String(error)}\n`);
	process.exitCode = 1;
});
