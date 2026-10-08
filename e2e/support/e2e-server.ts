/**
 * TEST ONLY. The real IdP app (provider, pages, MongoDB adapter, account
 * layer) on a fixed port against mongodb-memory-server, with Google, GitHub
 * and Telegram answered by fakes. A second tiny server plays the client app
 * (OAuth callbacks) and exposes the Telegram messages the bot "sent".
 * Started and stopped by Playwright's webServer.
 */
import { randomBytes } from "node:crypto";
import { type Server, createServer } from "node:http";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
	FAKE_UPSTREAM_ENV,
	FakeUpstreams,
} from "../../src/__tests__/helpers/fake-upstreams.js";
import { AccountRepository } from "../../src/accounts/account-repository.js";
import { createApp } from "../../src/app.js";
import { parseEnv } from "../../src/config/env.js";
import { createLogger } from "../../src/logger.js";
import { generateSigningJwk } from "../../src/oidc/jwks.js";
import { ensureOidcIndexes } from "../../src/oidc/mongo-adapter.js";
import { createProvider } from "../../src/oidc/provider.js";
import {
	createServices,
	ensureAccountLayerIndexes,
} from "../../src/services.js";
import {
	E2E_ISSUER,
	E2E_PORT,
	E2E_TOOLS,
	E2E_TOOLS_PORT,
} from "./e2e-config.js";

function listen(server: Server, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => resolve());
	});
}

const fake = new FakeUpstreams();
fake.install();
const mongod = await MongoMemoryServer.create();
const mongo = new MongoClient(`${mongod.getUri().replace(/\/$/, "")}/auth`);
await mongo.connect();
const db = mongo.db();
await ensureOidcIndexes(db);
await ensureAccountLayerIndexes(db);

const env = parseEnv({
	NODE_ENV: "test",
	ISSUER: E2E_ISSUER,
	MONGO_URL: `${mongod.getUri().replace(/\/$/, "")}/auth`,
	SIGNING_KEYS_PATH: "unused-in-e2e.json",
	COOKIE_KEYS: randomBytes(32).toString("base64url"),
	LOCALMAN_WEB_CLIENT_SECRET: randomBytes(32).toString("base64url"),
	TUNELO_WEB_CLIENT_SECRET: randomBytes(32).toString("base64url"),
	LOCALMAN_WEB_URL: E2E_TOOLS,
	LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? "warn",
	...FAKE_UPSTREAM_ENV,
});
const logger = createLogger(env.LOG_LEVEL);
const accounts = new AccountRepository(db);
const provider = createProvider({
	env,
	db,
	jwks: { keys: [await generateSigningJwk()] },
	accountStore: accounts,
	logger,
});
const services = createServices({
	env,
	db,
	provider,
	logger,
	accounts,
	formPostsPerMinute: 1_000,
});
const idp = createServer(createApp({ services, env, rateLimits: [] }));

const tools = createServer((req, res) => {
	const url = new URL(req.url ?? "/", E2E_TOOLS);
	if (url.pathname === "/telegram/messages") {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify(fake.telegramMessages));
		return;
	}
	res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
	res.end("<!DOCTYPE html><title>Client app</title><h1>Client callback</h1>");
});

await listen(idp, E2E_PORT);
await listen(tools, E2E_TOOLS_PORT);
logger.warn({ issuer: E2E_ISSUER }, "e2e IdP ready");

let stopping = false;
async function stop(): Promise<void> {
	if (stopping) return;
	stopping = true;
	idp.closeAllConnections();
	tools.closeAllConnections();
	await Promise.all([
		new Promise((resolve) => idp.close(resolve)),
		new Promise((resolve) => tools.close(resolve)),
	]);
	await mongo.close();
	await mongod.stop();
	process.exit(0);
}
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
