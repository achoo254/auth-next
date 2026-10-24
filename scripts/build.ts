import { readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { z } from "zod";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "dist");

const manifest = z
	.object({ dependencies: z.record(z.string(), z.string()) })
	.parse(JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")));

// Runtime dependencies stay external and load from node_modules; only the
// application source is bundled. The client check ships too, so it runs in
// the production image: `node dist/seed-clients.mjs`, and so do the key
// generator (signing keys are created on the server and never travel), the
// index pass run before a deploy, the read-only growth report and the
// finish-account-deletion repair script.
rmSync(distDir, { recursive: true, force: true });
await build({
	entryPoints: {
		server: resolve(root, "src/server.ts"),
		"seed-clients": resolve(root, "scripts/seed-clients.ts"),
		"generate-signing-key": resolve(root, "scripts/generate-signing-key.ts"),
		"create-indexes": resolve(root, "scripts/create-indexes.ts"),
		"growth-report": resolve(root, "scripts/growth-report.ts"),
		"finish-account-deletion": resolve(
			root,
			"scripts/finish-account-deletion.ts",
		),
	},
	outdir: distDir,
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	target: "node22",
	format: "esm",
	sourcemap: true,
	external: Object.keys(manifest.dependencies),
	logLevel: "info",
});
