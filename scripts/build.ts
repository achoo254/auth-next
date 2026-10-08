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
// application source is bundled.
rmSync(distDir, { recursive: true, force: true });
await build({
	entryPoints: [resolve(root, "src/server.ts")],
	outfile: resolve(distDir, "server.mjs"),
	bundle: true,
	platform: "node",
	target: "node22",
	format: "esm",
	sourcemap: true,
	external: Object.keys(manifest.dependencies),
	logLevel: "info",
});
