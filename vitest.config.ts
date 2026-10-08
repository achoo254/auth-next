import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		globalSetup: ["src/__tests__/helpers/global-setup.ts"],
		testTimeout: 30_000,
		hookTimeout: 120_000,
		// Shared 16 GB machine: never more than two test workers, however the
		// suite is started (pnpm 11 does not forward `pnpm test -- <args>`).
		maxWorkers: 2,
		minWorkers: 1,
	},
});
