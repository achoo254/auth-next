import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { getWithHost } from "../__tests__/helpers/request-with-host.js";
import type { TrustProxy } from "../config/trust-proxy.js";
import { OIDC_ROUTES } from "../oidc/provider.js";
import {
	RATE_LIMIT_RULES,
	type RateLimitRule,
	applySecurity,
	forwardTrustedClientInfo,
	nativeRedirectSchemes,
	requireKnownHost,
	securityHeaders,
} from "./security.js";

let server: Server | undefined;

afterEach(async () => {
	server?.closeAllConnections();
	await new Promise<void>(
		(resolve) => server?.close(() => resolve()) ?? resolve(),
	);
	server = undefined;
});

/** App that echoes what a mounted provider would see after the security layer. */
async function startEchoApp(
	trustProxy: TrustProxy,
	rateLimits: readonly RateLimitRule[] = [],
): Promise<string> {
	const app = express();
	applySecurity(app, { trustProxy, issuer: "http://localhost", rateLimits });
	app.use(forwardTrustedClientInfo, (req, res) => {
		res.json({
			ip: req.ip,
			forwardedFor: req.headers["x-forwarded-for"],
			forwardedProto: req.headers["x-forwarded-proto"],
			forwardedHost: req.headers["x-forwarded-host"] ?? null,
		});
	});
	const listening = app.listen(0, "127.0.0.1");
	server = listening;
	await new Promise<void>((resolve) => listening.once("listening", resolve));
	return `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;
}

const SPOOFED = {
	"x-forwarded-for": "203.0.113.9",
	"x-forwarded-proto": "https",
	"x-forwarded-host": "evil.example",
};

describe("trusted proxy handling", () => {
	it("ignores forwarded headers from an untrusted peer", async () => {
		const base = await startEchoApp(false);
		const body = await (await fetch(`${base}/x`, { headers: SPOOFED })).json();
		expect(body).toEqual({
			ip: "127.0.0.1",
			forwardedFor: "127.0.0.1",
			forwardedProto: "http",
			forwardedHost: null,
		});
	});

	it("takes the client IP and protocol from a trusted proxy", async () => {
		const base = await startEchoApp(["loopback"]);
		const body = await (await fetch(`${base}/x`, { headers: SPOOFED })).json();
		expect(body).toEqual({
			ip: "203.0.113.9",
			forwardedFor: "203.0.113.9",
			forwardedProto: "https",
			forwardedHost: null,
		});
	});

	it("skips spoofed hops left of the first untrusted address", async () => {
		const base = await startEchoApp(["loopback"]);
		const body = await (
			await fetch(`${base}/x`, {
				headers: { "x-forwarded-for": "1.1.1.1, 198.51.100.7" },
			})
		).json();
		expect(body.ip).toBe("198.51.100.7");
	});
});

describe("rate limits", () => {
	it("limits the exact configured paths per client", async () => {
		const base = await startEchoApp(false, [
			{ name: "token", paths: ["/token"], windowMs: 60_000, limit: 2 },
		]);
		const statuses: number[] = [];
		for (let attempt = 0; attempt < 3; attempt += 1) {
			statuses.push((await fetch(`${base}/token`, { method: "POST" })).status);
		}
		expect(statuses).toEqual([200, 200, 429]);
		// Neighbouring paths are not counted against /token.
		expect((await fetch(`${base}/token/introspection`)).status).toBe(200);
	});
});

describe("rate limit path matching", () => {
	it("counts case and trailing-slash variants the provider router accepts", async () => {
		const base = await startEchoApp(false, [
			{ name: "token", paths: ["/token"], windowMs: 60_000, limit: 2 },
			{ name: "registration", paths: ["/reg"], windowMs: 60_000, limit: 1 },
		]);
		const status = async (path: string): Promise<number> =>
			(await fetch(`${base}${path}`, { method: "POST" })).status;

		expect([await status("/token"), await status("/token")]).toEqual([
			200, 200,
		]);
		for (const variant of ["/TOKEN", "/Token", "/token/", "//token"]) {
			expect(await status(variant), variant).toBe(429);
		}
		expect(await status("/reg")).toBe(200);
		expect(await status("/REG")).toBe(429);
		expect(await status("/reg/")).toBe(429);
	});

	it("limits every public flow endpoint, including PAR", () => {
		const limited = RATE_LIMIT_RULES.flatMap((rule) => rule.paths);
		for (const route of [
			OIDC_ROUTES.token,
			OIDC_ROUTES.authorization,
			OIDC_ROUTES.code_verification,
			OIDC_ROUTES.device_authorization,
			OIDC_ROUTES.registration,
			OIDC_ROUTES.pushed_authorization_request,
		]) {
			expect(limited, route).toContain(route);
		}
	});
});

describe("host check", () => {
	async function statusWithHost(base: string, host: string): Promise<number> {
		return (await getWithHost(`${base}/x`, host)).status;
	}

	it("answers 421 for hosts other than the issuer's", async () => {
		const app = express();
		app.use(requireKnownHost(["auth.hoandat.com", "localhost:4500"]));
		app.use((_req, res) => {
			res.sendStatus(200);
		});
		const listening = app.listen(0, "127.0.0.1");
		server = listening;
		await new Promise<void>((resolve) => listening.once("listening", resolve));
		const base = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;

		expect(await statusWithHost(base, "auth.hoandat.com")).toBe(200);
		expect(await statusWithHost(base, "AUTH.hoandat.com")).toBe(200);
		expect(await statusWithHost(base, "localhost:4500")).toBe(200);
		expect(await statusWithHost(base, "evil.example")).toBe(421);
		expect(await statusWithHost(base, "localhost:4501")).toBe(421);
	});
});

describe("form-action", () => {
	it("lets the consent form redirect to the native apps' schemes", async () => {
		const schemes = nativeRedirectSchemes({
			CHAT_MOBILE_REDIRECT_URI: "com.hoandat.chat:/auth/callback",
			SCRIBE_MOBILE_REDIRECT_URI: "com.hoandat.scribe:/auth/callback",
			MIU_MOBILE_REDIRECT_URI: "com.hoandat.miu:/auth/callback",
		});
		expect(schemes).toEqual([
			"com.hoandat.chat:",
			"com.hoandat.scribe:",
			"com.hoandat.miu:",
		]);
		const app = express();
		app.use(securityHeaders("https://auth.example.com", schemes));
		app.get("/", (_req, res) => {
			res.send("ok");
		});
		server = app.listen(0);
		const { port } = server.address() as AddressInfo;
		const res = await fetch(`http://127.0.0.1:${port}/`);
		const formAction = (res.headers.get("content-security-policy") ?? "")
			.split(";")
			.find((d) => d.trim().startsWith("form-action"));
		expect(formAction).toContain("com.hoandat.scribe:");
		expect(formAction).toContain("com.hoandat.chat:");
		expect(formAction).toContain("com.hoandat.miu:");
	});
});
