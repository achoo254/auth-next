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
// the production image: `node dist/seed-clients.mjs`, and so does the key
// generator, so signing keys are created on the server and never travel,
// and the tenant migration steps (indexes before a deploy, backfill after).
rmSync(distDir, { recursive: true, force: true });
await build({
	entryPoints: {
		server: resolve(root, "src/server.ts"),
		"seed-clients": resolve(root, "scripts/seed-clients.ts"),
		"generate-signing-key": resolve(root, "scripts/generate-signing-key.ts"),
		"create-tenant-indexes": resolve(root, "scripts/create-tenant-indexes.ts"),
		"backfill-tenant-id": resolve(root, "scripts/backfill-tenant-id.ts"),
		"app-client-key": resolve(root, "scripts/app-client-key.ts"),
		"tenant-provisioner": resolve(root, "scripts/tenant-provisioner.ts"),
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
