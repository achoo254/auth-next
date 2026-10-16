import { describe, expect, it } from "vitest";
import { appHostsFor, normalizeTenantDomain } from "./tenant.js";

describe("normalizeTenantDomain", () => {
	it.each([
		["Example.COM", "example.com"],
		["example.com.", "example.com"],
		["example.com:443", "example.com"],
		["  dev.example.co.uk ", "dev.example.co.uk"],
		["xn--bcher-kva.com", "xn--bcher-kva.com"],
		["bücher.com", "xn--bcher-kva.com"],
		["user.github.io", "user.github.io"],
		["tên-miền.vn", "xn--tn-min-iva0322d.vn"],
	])("accepts %s as %s", (input, expected) => {
		expect(normalizeTenantDomain(input)).toBe(expected);
	});

	it.each([
		"",
		"com",
		"com.vn",
		"co.uk",
		"github.io",
		"localhost",
		"foo.localhost",
		"a.b.internal",
		"x.test",
		"x.example",
		"x.local",
		"x.onion",
		"x.home.arpa",
		"abc.zz",
		"127.0.0.1",
		"[::1]",
		"example..com",
		"-example.com",
		"example-.com",
		"exa_mple.com",
		"example.com;rm -rf /",
		"example.com\nserver_name evil",
		"example .com",
		"example.com/path",
		"*.example.com",
		"$host.example.com",
		`${"a".repeat(64)}.com`,
		`${"a.".repeat(127)}com`,
	])("refuses %j", (input) => {
		expect(normalizeTenantDomain(input)).toBeUndefined();
	});

	it("refuses a blocked domain and everything under it", () => {
		const blocked = ["HoanDat.com.", "inetdev.io.vn"];
		expect(normalizeTenantDomain("hoandat.com", blocked)).toBeUndefined();
		expect(normalizeTenantDomain("x.hoandat.com", blocked)).toBeUndefined();
		expect(
			normalizeTenantDomain("TUNNEL.inetdev.io.vn", blocked),
		).toBeUndefined();
		expect(normalizeTenantDomain("nothoandat.com", blocked)).toBe(
			"nothoandat.com",
		);
	});
});

describe("appHostsFor", () => {
	it("follows the auth./chat./localman./tunnel. convention", () => {
		expect(appHostsFor("example.org")).toEqual({
			auth: "auth.example.org",
			chat: "chat.example.org",
			localman: "localman.example.org",
			localmanWildcard: "*.localman.example.org",
			tunnel: "tunnel.example.org",
			tunnelWildcard: "*.tunnel.example.org",
		});
	});
});
