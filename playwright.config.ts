import { defineConfig, devices } from "@playwright/test";
import { E2E_ISSUER } from "./e2e/support/e2e-config.js";

/**
 * End-to-end tests of the IdP pages in Chromium against the real app
 * (e2e/support/e2e-server.ts). One worker: the machine is shared and the
 * suites share one server.
 */
export default defineConfig({
	testDir: "e2e",
	// Guide screenshots run on their own (playwright.guide.config.ts).
	testIgnore: "guide/**",
	workers: 1,
	fullyParallel: false,
	forbidOnly: true,
	retries: 0,
	timeout: 60_000,
	reporter: [["list"]],
	use: {
		baseURL: E2E_ISSUER,
		locale: "vi-VN",
		timezoneId: "Asia/Ho_Chi_Minh",
		trace: "retain-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		command: "pnpm exec tsx e2e/support/e2e-server.ts",
		url: `${E2E_ISSUER}/healthz`,
		reuseExistingServer: false,
		timeout: 120_000,
		gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
		stdout: "pipe",
		stderr: "pipe",
	},
});
