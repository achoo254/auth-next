import { randomBytes, randomUUID } from "node:crypto";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { MongoClient } from "mongodb";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { parseEnv } from "../config/env.js";
import { createLogger } from "../logger.js";
import { generateSigningJwk } from "../oidc/jwks.js";
import { PRIMARY_TENANT_ID } from "../tenants/env-tenant.js";
import { type Serving, createServing } from "../tenants/serving.js";
import { getWithHost } from "./helpers/request-with-host.js";

const ISSUER = "http://auth.serving.test:4500";
const EXTRA_HOST = "127.0.0.1:4500";

let mongo: MongoClient;
let serving: Serving;
let server: Server;
let base: string;

beforeAll(async () => {
	const mongoUrl = `${inject("mongoUri").replace(/\/$/, "")}/serving_${randomUUID().slice(0, 8)}`;
	mongo = new MongoClient(mongoUrl);
	await mongo.connect();
	const env = parseEnv({
		NODE_ENV: "test",
		ISSUER,
		ALLOWED_HOSTS: EXTRA_HOST,
		MONGO_URL: mongoUrl,
		SIGNING_KEYS_PATH: "unused-in-tests.json",
		COOKIE_KEYS: randomBytes(32).toString("base64url"),
		LOCALMAN_WEB_CLIENT_SECRET: randomBytes(32).toString("base64url"),
		TUNELO_WEB_CLIENT_SECRET: randomBytes(32).toString("base64url"),
		CHAT_WEB_CLIENT_SECRET: randomBytes(32).toString("base64url"),
		LOG_LEVEL: "silent",
	});
	const jwks = { keys: [await generateSigningJwk()] };
	serving = createServing(env, mongo.db(), jwks, createLogger("silent"));
	server = createServer(serving.app);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	server?.closeAllConnections();
	await new Promise<void>((resolve) => server?.close(() => resolve()));
	await serving?.stop();
	await mongo?.db().dropDatabase();
	await mongo?.close();
});

describe("the server process", () => {
	it("serves the primary tenant from the environment", () => {
		expect(serving.primary.tenant.id).toBe(PRIMARY_TENANT_ID);
		expect(serving.primary.tenant.issuer).toBe(ISSUER);
		expect(serving.primary.services.audit.tenant.id).toBe(PRIMARY_TENANT_ID);
	});

	it("answers at its issuer's host and ALLOWED_HOSTS, 421 elsewhere", async () => {
		const discovery = `${base}/.well-known/openid-configuration`;
		const atIssuer = await getWithHost(discovery, new URL(ISSUER).host);
		expect(atIssuer.status).toBe(200);
		expect(JSON.parse(atIssuer.body)).toMatchObject({ issuer: ISSUER });
		expect((await getWithHost(discovery, EXTRA_HOST)).status).toBe(200);
		for (const host of ["auth.example.org", "auth.inetdev.io.vn"]) {
			expect((await getWithHost(discovery, host)).status, host).toBe(421);
		}
		expect((await getWithHost(`${base}/healthz`, "evil.example")).status).toBe(
			200,
		);
	});

	it("no longer serves domain claims, tenant admin or enrollment", async () => {
		const host = new URL(ISSUER).host;
		for (const path of [
			"/claim",
			"/admin",
			"/guide/domain",
			"/.well-known/hoandat-enrollment",
		]) {
			expect((await getWithHost(`${base}${path}`, host)).status, path).toBe(
				404,
			);
		}
	});
});
