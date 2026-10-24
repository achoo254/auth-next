import { describe, expect, it } from "vitest";
import { type ConfigFiles, readNginxConfig } from "./nginx-config.js";
import { configuredServerNames, conflictingName } from "./nginx-names.js";

const posix = (path: string): string => path.replaceAll("\\", "/");

describe("conflictingName", () => {
	const names = (config: string) => configuredServerNames(config);

	it.each([
		["an exact name", "server_name auth.legacy.org;", "auth.legacy.org"],
		["a quoted name", 'server_name "auth.legacy.org";', "auth.legacy.org"],
		["a leading wildcard", "server_name *.legacy.org;", "auth.legacy.org"],
		["a leading dot", "server_name .legacy.org;", "auth.legacy.org"],
		[
			"a mock wildcard",
			"server_name *.localman.legacy.org;",
			"probe-label.localman.legacy.org",
		],
		["a regex", "server_name ~^tunnel\\.(?P<x>.+)$;", "tunnel.legacy.org"],
		[
			"a regex JavaScript cannot read",
			"server_name ~^auth\\.(?i)x$;",
			"auth.legacy.org",
		],
	])("sees %s", (_label, config, host) => {
		expect(conflictingName("legacy.org", names(`server { ${config} }`))).toBe(
			host,
		);
	});

	it("ignores other domains and the tenants' own blocks", () => {
		const config = `
server { server_name auth.hoandat.com *.localman.hoandat.com _; }
server { server_name ~^auth\\.(?<tenant>.+)$; }
server { server_name ~^(?:[^.]+\\.)?(?:auth|localman|tunnel)\\.(?<tenant>.+)$; }`;
		expect(conflictingName("acme.org", names(config))).toBeUndefined();
	});

	it("checks scribe work against scribe.<domain> only, past the tenants' Scribe block", () => {
		const config = `
server { server_name scribe.hoandat.com; }
server { server_name ~^scribe\\.(?<tenant>.+)$; }
server { server_name ~^(?:[^.]+\\.)?(?:auth|chat|localman|tunnel|scribe)\\.(?<tenant>.+)$; }
server { server_name auth.legacy.org; }`;
		expect(
			conflictingName("acme.org", names(config), "scribe"),
		).toBeUndefined();
		expect(conflictingName("legacy.org", names(config), "scribe")).toBe(
			undefined,
		);
		expect(conflictingName("legacy.org", names(config))).toBe(
			"auth.legacy.org",
		);
		expect(conflictingName("hoandat.com", names(config), "scribe")).toBe(
			"scribe.hoandat.com",
		);
	});
});

describe("readNginxConfig", () => {
	it("follows includes, relative ones and globs, once each", async () => {
		const tree: Record<string, string> = {
			"/etc/nginx/nginx.conf":
				"http { include /etc/nginx/mime.types; include conf.d/*.conf; include extra.conf; }",
			"/etc/nginx/extra.conf":
				"server { server_name extra.org; } include conf.d/a.conf;",
			"/etc/nginx/conf.d/a.conf": "server { server_name a.org; }",
			"/etc/nginx/conf.d/b.conf": "server { server_name b.org; }",
			"/etc/nginx/conf.d/notes.txt": "server { server_name hidden.org; }",
		};
		const files: ConfigFiles = {
			// path.join yields backslashes on Windows; the tree is POSIX.
			read: async (rawPath) => {
				const path = posix(rawPath);
				const text = tree[path];
				if (text === undefined) throw new Error(`ENOENT ${path}`);
				return text;
			},
			list: async (rawDir) => {
				const dir = posix(rawDir);
				return Object.keys(tree)
					.filter((path) => path.startsWith(`${dir}/`))
					.map((path) => path.slice(dir.length + 1));
			},
		};
		const names = configuredServerNames(
			await readNginxConfig("/etc/nginx/nginx.conf", files),
		);
		expect(names.sort()).toEqual(["a.org", "b.org", "extra.org"]);
	});
});
