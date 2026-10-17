import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import type { Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newPullToken } from "../tenants/pull-tokens.js";
import { createReleaseRegistryRouter } from "../tenants/release-registry.js";
import { createReleaseUpstream } from "../tenants/release-upstream.js";
import { bindRequestTenant } from "../tenants/request-tenant.js";
import {
	type TenantDocument,
	TenantRegistry,
	ensureTenantRegistryIndexes,
	newTenantId,
} from "../tenants/tenant-registry.js";
import { openTestDb } from "./helpers/test-accounts.js";
import { PRIMARY_TEST_TENANT } from "./helpers/test-tenant.js";

/*
 * The release registry of self-hosted installs (ADR 0007): the router for
 * real on a loopback port, GHCR replaced by a fetch that records calls.
 */

const OWNER = "release-owner";
const GHCR_TOKEN = "ghp_classic_token_for_tests";
const DIGEST = `sha256:${"a".repeat(64)}`;
const CDN = "https://pkg-containers.example/blob?sig=signed";

let db: Db;
let close: () => Promise<void>;
let server: Server;
let origin: string;
let ghcrCalls: {
	url: string;
	authorization: string;
	accept: string;
	redirect?: string;
}[];

const fakeGhcr: typeof fetch = async (input, init) => {
	const url = String(input);
	const headers = new Headers(init?.headers);
	ghcrCalls.push({
		url,
		authorization: headers.get("authorization") ?? "",
		accept: headers.get("accept") ?? "",
		redirect: init?.redirect,
	});
	if (url.startsWith("https://ghcr.io/token")) {
		return Response.json({ token: "ghcr-pull-token" });
	}
	if (url.endsWith("/manifests/1.0.0")) {
		return new Response('{"schemaVersion":2}', {
			headers: {
				"content-type": "application/vnd.oci.image.index.v1+json",
				"docker-content-digest": DIGEST,
			},
		});
	}
	if (url.endsWith(`/blobs/${DIGEST}`)) {
		return new Response(null, { status: 307, headers: { location: CDN } });
	}
	if (url.endsWith("/tags/list")) {
		return Response.json({
			name: `${OWNER}/selfhosted-auth`,
			tags: ["1.0.0", "1.1.0"],
		});
	}
	return new Response("{}", { status: 404 });
};

async function tenantWith(
	status: TenantDocument["status"],
	hash?: string,
): Promise<string> {
	const id = newTenantId();
	await new TenantRegistry(db).insert({
		_id: id,
		domain: `${id.toLowerCase().replace(/_/g, "-")}.example.org`,
		displayName: "own",
		status,
		createdAt: new Date(),
		...(hash ? { pullTokenHash: hash } : {}),
	});
	return id;
}

function basic(id: string, token: string): Record<string, string> {
	return {
		authorization: `Basic ${Buffer.from(`${id}:${token}`).toString("base64")}`,
	};
}

beforeAll(async () => {
	({ db, close } = await openTestDb());
	await ensureTenantRegistryIndexes(db);
	const app = express()
		.use(bindRequestTenant(PRIMARY_TEST_TENANT))
		.use(
			createReleaseRegistryRouter(
				new TenantRegistry(db),
				createReleaseUpstream({
					owner: OWNER,
					token: GHCR_TOKEN,
					fetch: fakeGhcr,
				}),
			),
		);
	server = app.listen(0, "127.0.0.1");
	await new Promise((resolve) => server.once("listening", resolve));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
	ghcrCalls = [];
	await db.collection("tenants").deleteMany({});
});

afterAll(async () => {
	await new Promise((resolve) => server.close(resolve));
	await close?.();
});

describe("release registry for self-hosted installs", () => {
	it("asks for Basic credentials and lets only a self-hosted tenant's current token in", async () => {
		const { token, hash } = newPullToken();
		const id = await tenantWith("self_hosted", hash);
		const anonymous = await fetch(`${origin}/v2/`);
		expect(anonymous.status).toBe(401);
		expect(anonymous.headers.get("www-authenticate")).toBe(
			'Basic realm="hoandat releases"',
		);
		expect(
			(await fetch(`${origin}/v2/`, { headers: basic(id, "hpt_wrong") }))
				.status,
		).toBe(401);
		const enrolling = await tenantWith("enrolling", hash);
		expect(
			(await fetch(`${origin}/v2/`, { headers: basic(enrolling, token) }))
				.status,
		).toBe(401);
		const ok = await fetch(`${origin}/v2/`, { headers: basic(id, token) });
		expect(ok.status).toBe(200);
		expect(ok.headers.get("docker-distribution-api-version")).toBe(
			"registry/2.0",
		);
		expect(ghcrCalls).toEqual([]);
	});

	it("relays manifests and tags from GHCR, and redirects blobs to its CDN", async () => {
		const { token, hash } = newPullToken();
		const id = await tenantWith("self_hosted", hash);
		const accept = "application/vnd.oci.image.index.v1+json";
		const manifest = await fetch(
			`${origin}/v2/selfhosted-auth/manifests/1.0.0`,
			{
				headers: { ...basic(id, token), accept },
			},
		);
		expect(manifest.status).toBe(200);
		expect(manifest.headers.get("docker-content-digest")).toBe(DIGEST);
		expect(await manifest.text()).toBe('{"schemaVersion":2}');
		const blob = await fetch(`${origin}/v2/selfhosted-auth/blobs/${DIGEST}`, {
			headers: basic(id, token),
			redirect: "manual",
		});
		expect(blob.status).toBe(307);
		expect(blob.headers.get("location")).toBe(CDN);
		const tags = await fetch(`${origin}/v2/selfhosted-auth/tags/list`, {
			headers: basic(id, token),
		});
		expect(await tags.json()).toEqual({
			name: "selfhosted-auth",
			tags: ["1.0.0", "1.1.0"],
		});

		const upstream = ghcrCalls.filter((call) => call.url.includes("/v2/"));
		expect(upstream.map((call) => call.url)).toEqual([
			`https://ghcr.io/v2/${OWNER}/selfhosted-auth/manifests/1.0.0`,
			`https://ghcr.io/v2/${OWNER}/selfhosted-auth/blobs/${DIGEST}`,
			`https://ghcr.io/v2/${OWNER}/selfhosted-auth/tags/list`,
		]);
		expect(
			upstream.every((call) => call.authorization === "Bearer ghcr-pull-token"),
		).toBe(true);
		expect(upstream.every((call) => call.redirect === "manual")).toBe(true);
		expect(upstream[0]?.accept).toBe(accept);
		// One GHCR token for the image, asked with the classic token, then cached.
		const tokenCalls = ghcrCalls.filter((call) =>
			call.url.startsWith("https://ghcr.io/token"),
		);
		expect(tokenCalls).toHaveLength(1);
		expect(tokenCalls[0]?.authorization).toBe(
			`Basic ${Buffer.from(`${OWNER}:${GHCR_TOKEN}`).toString("base64")}`,
		);
	});

	it("serves the release images only, with valid references", async () => {
		const { token, hash } = newPullToken();
		const id = await tenantWith("self_hosted", hash);
		const get = (path: string) =>
			fetch(`${origin}${path}`, { headers: basic(id, token) });
		expect((await get("/v2/other-image/manifests/1.0.0")).status).toBe(404);
		expect((await get("/v2/selfhosted-auth/manifests/..%2Fx")).status).toBe(
			400,
		);
		expect((await get("/v2/selfhosted-auth/blobs/1.0.0")).status).toBe(400);
		expect((await get(`/v2/selfhosted-auth/referrers/${DIGEST}`)).status).toBe(
			404,
		);
		expect(ghcrCalls).toEqual([]);
	});
});
