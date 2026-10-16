import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLOUDFLARE_IPV4_RANGES, isCloudflareIpv4 } from "./cloudflare-ips.js";
import { pointsHere } from "./ownership-records.js";

describe("isCloudflareIpv4", () => {
	it("accepts addresses inside the ranges, edges included", () => {
		expect(isCloudflareIpv4("104.16.0.0")).toBe(true);
		expect(isCloudflareIpv4("104.23.255.255")).toBe(true);
		expect(isCloudflareIpv4("104.27.255.255")).toBe(true);
		expect(isCloudflareIpv4("172.67.180.12")).toBe(true);
		expect(isCloudflareIpv4("188.114.97.3")).toBe(true);
	});

	it("rejects other addresses and non-addresses", () => {
		expect(isCloudflareIpv4("104.28.0.0")).toBe(false);
		expect(isCloudflareIpv4("103.72.98.65")).toBe(false);
		expect(isCloudflareIpv4("127.0.0.1")).toBe(false);
		expect(isCloudflareIpv4("2606:4700::1")).toBe(false);
		expect(isCloudflareIpv4("104.16.0")).toBe(false);
	});

	it("matches the geo block nginx uses for Flexible SSL", () => {
		const conf = readFileSync("infra/nginx/tenants-http.conf", "utf8");
		const block =
			/geo \$realip_remote_addr \$tenant_from_cloudflare \{([^}]*)\}/.exec(
				conf,
			);
		const listed = [
			...(block?.[1] ?? "").matchAll(/^\s*([0-9./]+)\s+1;/gm),
		].map((match) => match[1]);
		expect(listed).toEqual(CLOUDFLARE_IPV4_RANGES);
	});
});

describe("pointsHere", () => {
	const service = "203.0.113.65";

	it("accepts a DNS-only record on the service address", () => {
		expect(pointsHere([service], service)).toBe(true);
	});

	it("accepts a record proxied by Cloudflare", () => {
		expect(pointsHere(["104.21.4.9", "172.67.180.12"], service)).toBe(true);
	});

	it("rejects no record, another address, or a mix", () => {
		expect(pointsHere([], service)).toBe(false);
		expect(pointsHere(["198.51.100.7"], service)).toBe(false);
		expect(pointsHere([service, "198.51.100.7"], service)).toBe(false);
		expect(pointsHere([service, "104.21.4.9"], service)).toBe(false);
	});
});
