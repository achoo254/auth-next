import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		globalSetup: ["src/__tests__/helpers/global-setup.ts"],
		testTimeout: 30_000,
		hookTimeout: 120_000,
	},
});
