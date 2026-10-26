import type { BrandConfig } from "@shared-next/brand";
import {
	type GenerateManifestsOptions,
	loadBrandConfig,
	svgManifestIcons,
} from "@shared-next/brand/build";

/** Repository root: the directory of brand.config.json and its icon paths. */
export const BRAND_ROOT = new URL("../", import.meta.url);
/** Where `pnpm brand:gen` writes the web manifest and icons/. */
export const BRAND_GENERATED_DIR = new URL("brand/generated/", BRAND_ROOT);

export function loadAuthBrand(): BrandConfig {
	return loadBrandConfig(BRAND_ROOT, {
		require: ["webInstall", "colors.primary"],
	});
}

/** The web manifest of the account site (no Capacitor: the iOS app is native). */
export const MANIFEST_OPTIONS: GenerateManifestsOptions = {
	web: {
		id: "/",
		lang: "en",
		dir: "ltr",
		themeColor: "primary",
		categories: ["productivity", "utilities"],
		preferRelatedApplications: false,
		icons: svgManifestIcons(),
	},
};
