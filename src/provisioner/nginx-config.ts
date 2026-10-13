import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";

/** Reads a file; tests pass an in-memory tree. */
export interface ConfigFiles {
	read(path: string): Promise<string>;
	/** Entries of a directory (names only). */
	list(dir: string): Promise<string[]>;
}

export const DISK_FILES: ConfigFiles = {
	read: (path) => readFile(path, "utf8"),
	list: (dir) => readdir(dir),
};

/** `*` and `?` of an include pattern, on the file name only (nginx's glob). */
function matchesGlob(pattern: string, name: string): boolean {
	const regex = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp(`^${regex}$`).test(name);
}

async function expandInclude(
	files: ConfigFiles,
	pattern: string,
): Promise<string[]> {
	if (!/[*?]/.test(basename(pattern))) return [pattern];
	const dir = dirname(pattern);
	const names = await files.list(dir).catch(() => []);
	return names
		.filter((name) => matchesGlob(basename(pattern), name))
		.sort()
		.map((name) => join(dir, name));
}

/**
 * The whole nginx configuration as text, `include` directives followed
 * (relative paths from the main file's directory, globs on file names), so
 * the provisioner sees every server block without running `nginx -T`
 * (which needs write access the sandboxed unit does not have).
 */
export async function readNginxConfig(
	mainFile: string,
	files: ConfigFiles = DISK_FILES,
): Promise<string> {
	const root = dirname(mainFile);
	const seen = new Set<string>();
	const visit = async (path: string, depth: number): Promise<string> => {
		if (seen.has(path) || depth > 8) return "";
		seen.add(path);
		const text = await files.read(path);
		const parts: string[] = [text];
		for (const match of text.matchAll(/(?:^|[\s;{])include\s+([^;\s]+)\s*;/g)) {
			const raw = (match[1] ?? "").replace(/^["']|["']$/g, "");
			const pattern = isAbsolute(raw) ? raw : join(root, raw);
			for (const included of await expandInclude(files, pattern)) {
				if (included.endsWith("mime.types")) continue;
				parts.push(await visit(included, depth + 1).catch(() => ""));
			}
		}
		return parts.join("\n");
	};
	return visit(mainFile, 0);
}
