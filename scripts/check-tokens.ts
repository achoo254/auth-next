/**
 * `pnpm check:tokens` — colour literals live only in static/css/tokens.css
 * (the copy of Localman's design tokens). Every other stylesheet and every
 * TypeScript source must use the custom properties, so the IdP keeps the
 * Localman palette in light and dark mode.
 *
 * Flags hex colours (#abc, #aabbcc, with or without alpha) and rgb()/rgba()/
 * hsl()/hsla() calls. Exits 1 and prints file:line for each hit.
 */
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TOKENS_FILE = join(ROOT, "static/css/tokens.css");
const SCAN = [
	{ dir: join(ROOT, "src"), extensions: new Set([".ts", ".css"]) },
	{ dir: join(ROOT, "static"), extensions: new Set([".css", ".js", ".html"]) },
];

const RULES: readonly [string, RegExp][] = [
	["hex colour", /(?<![&\w])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi],
	["rgb()/hsl() colour", /\b(?:rgba?|hsla?)\s*\(/gi],
];

async function listFiles(
	dir: string,
	extensions: ReadonlySet<string>,
): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) return listFiles(path, extensions);
			return extensions.has(extname(entry.name)) ? [path] : [];
		}),
	);
	return nested.flat();
}

interface Violation {
	readonly file: string;
	readonly line: number;
	readonly rule: string;
	readonly match: string;
}

function findViolations(file: string, source: string): Violation[] {
	const violations: Violation[] = [];
	source.split("\n").forEach((text, index) => {
		for (const [rule, pattern] of RULES) {
			for (const match of text.matchAll(pattern)) {
				violations.push({ file, line: index + 1, rule, match: match[0] });
			}
		}
	});
	return violations;
}

async function main(): Promise<number> {
	const files = (
		await Promise.all(
			SCAN.map(({ dir, extensions }) => listFiles(dir, extensions)),
		)
	)
		.flat()
		.filter((file) => file !== TOKENS_FILE)
		.sort();
	const violations = (
		await Promise.all(
			files.map(async (file) =>
				findViolations(relative(ROOT, file), await readFile(file, "utf8")),
			),
		)
	).flat();
	if (violations.length > 0) {
		process.stderr.write(
			`✗ ${violations.length} colour literal(s) outside static/css/tokens.css:\n`,
		);
		for (const v of violations) {
			process.stderr.write(`  ${v.file}:${v.line}  [${v.rule}]  ${v.match}\n`);
		}
		return 1;
	}
	process.stdout.write(
		`✓ No colour literals in ${files.length} files (src/, static/) outside tokens.css\n`,
	);
	return 0;
}

main().then(
	(code) => {
		process.exitCode = code;
	},
	(error: unknown) => {
		process.stderr.write(`check:tokens crashed: ${String(error)}\n`);
		process.exitCode = 1;
	},
);
