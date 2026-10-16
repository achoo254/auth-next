import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";

/**
 * Screenshots of /claim and /admin for the domain guide (/guide/domain),
 * taken from the real pages with sample data: `pnpm guide:screenshots`.
 * Not part of `pnpm test:e2e`.
 */
export default defineConfig({
	...base,
	testDir: "e2e/guide",
	testIgnore: [],
	timeout: 120_000,
});
