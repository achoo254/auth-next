/**
 * TEST ONLY. The real IdP app (provider, pages, MongoDB adapter, account
 * layer) on a fixed port against mongodb-memory-server, with Google, GitHub
 * and Telegram answered by fakes. A second tiny server plays the client app
 * (OAuth callbacks), exposes the Telegram messages the bot "sent" and
 * holds the DNS records domain claims are checked against (fake resolver).
 * Claimed domains are served on their own hosts, as in production (tests
 * reach them with the tenant's Host header).
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
import { createTenantApp } from "../../src/app.js";
import { AuditOutbox } from "../../src/audit/audit-outbox.js";
import { parseEnv } from "../../src/config/env.js";
import {
	nativeRedirectSchemes,
	securityHeaders,
} from "../../src/http/security.js";
import { createDispatcher } from "../../src/http/tenant-dispatcher.js";
import { createLogger } from "../../src/logger.js";
import { generateSigningJwk } from "../../src/oidc/jwks.js";
import { ensureOidcIndexes } from "../../src/oidc/oidc-indexes.js";
import { createProvider } from "../../src/oidc/provider.js";
import {
	createServices,
	ensureAccountLayerIndexes,
} from "../../src/services.js";
import {
	envClientSecrets,
	envMiuClients,
	envScribeClients,
	envTenant,
} from "../../src/tenants/env-tenant.js";
import { RuntimeRegistry } from "../../src/tenants/runtime-registry.js";
import { parseKeyring } from "../../src/tenants/secret-keyring.js";
import { createTenancy } from "../../src/tenants/tenancy.js";
import { ensureTenantClaimIndexes } from "../../src/tenants/tenant-claims.js";
import {
	TenantRegistry,
	ensureTenantRegistryIndexes,
} from "../../src/tenants/tenant-registry.js";
import { buildTenantRuntime } from "../../src/tenants/tenant-runtime.js";
import { TenantSecrets } from "../../src/tenants/tenant-secrets.js";
import {
	E2E_ISSUER,
	E2E_PORT,
	E2E_SERVICE_IP,
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
await ensureTenantRegistryIndexes(db);
await ensureTenantClaimIndexes(db);

const env = parseEnv({
	NODE_ENV: "test",
	ISSUER: E2E_ISSUER,
	MONGO_URL: `${mongod.getUri().replace(/\/$/, "")}/auth`,
	SIGNING_KEYS_PATH: "unused-in-e2e.json",
	COOKIE_KEYS: randomBytes(32).toString("base64url"),
	LOCALMAN_WEB_CLIENT_SECRET: randomBytes(32).toString("base64url"),
	TUNELO_WEB_CLIENT_SECRET: randomBytes(32).toString("base64url"),
	CHAT_WEB_CLIENT_SECRET: randomBytes(32).toString("base64url"),
	LOCALMAN_WEB_URL: E2E_TOOLS,
	TENANT_SECRETS_KEY: `e2e:${randomBytes(32).toString("base64")}`,
	APP_CLIENT_SECRET_KEY: randomBytes(32).toString("base64url"),
	SERVICE_IPV4: E2E_SERVICE_IP,
	SELF_HOSTED_CLAIMS: "true",
	LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? "warn",
	...FAKE_UPSTREAM_ENV,
});
const logger = createLogger(env.LOG_LEVEL);
const tenant = envTenant(env);
/** DNS as the claim pages see it: `TXT <name>` / `A <name>` → values. */
const records = new Map<string, string[]>();
const notFound = (): Error =>
	Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
const keyring = parseKeyring(env.TENANT_SECRETS_KEY);
if (!keyring) throw new Error("e2e keyring missing");
const appClientSecretKey = env.APP_CLIENT_SECRET_KEY;
if (!appClientSecretKey) throw new Error("e2e app client key missing");
const registry = new TenantRegistry(db);
const secrets = new TenantSecrets(db, keyring);
const jwks = { keys: [await generateSigningJwk()] };
// The runtime registry is built after the tenancy that refers to it.
const built: { runtimes?: RuntimeRegistry } = {};
const tenancy = await createTenancy(
	env,
	db,
	logger,
	{ registry, secrets, signingJwks: jwks },
	(id) => built.runtimes?.dispose(id),
	{
		availableMemoryMb: () => 4_000,
		resolver: {
			resolveTxt: async (name) => {
				const value = records.get(`TXT ${name}`);
				if (!value) throw notFound();
				return [value];
			},
			resolve4: async (name) => {
				const parent = name.split(".").slice(1).join(".");
				const value = records.get(`A ${name}`) ?? records.get(`A *.${parent}`);
				if (!value) throw notFound();
				return value;
			},
		},
	},
);
const accounts = new AccountRepository(
	db,
	tenant,
	new AuditOutbox(db, tenant, logger),
);
const provider = createProvider({
	tenant,
	db,
	jwks,
	cookieKeys: env.COOKIE_KEYS,
	chatMobileRedirectUri: env.CHAT_MOBILE_REDIRECT_URI,
	scribeClients: envScribeClients(env),
	miuClients: envMiuClients(env),
	clientSecrets: envClientSecrets(env),
	accountStore: accounts,
	logger,
});
const services = createServices({
	env,
	tenant,
	db,
	provider,
	jwks,
	logger,
	accounts,
	formPostsPerMinute: 1_000,
	tenancy,
});
const runtimes = new RuntimeRegistry({
	primary: {
		tenant,
		services,
		app: createTenantApp({ services, env }),
		jwks,
		version: 0,
	},
	primaryHosts: [new URL(E2E_ISSUER).host],
	primaryDomain: tenant.domain,
	registry,
	maxActive: env.TENANT_MAX_ACTIVE,
	logger,
	build: (document) =>
		buildTenantRuntime(
			{ env, db, logger, secrets, appClientSecretKey, tenancy },
			document,
		),
});
built.runtimes = runtimes;
const idp = createServer(
	createDispatcher({
		trustProxy: env.TRUST_PROXY,
		rateLimits: [],
		logger,
		headers: securityHeaders(tenant.issuer, nativeRedirectSchemes(env)),
		lookup: (host) => runtimes.lookup(host),
	}),
);

const tools = createServer((req, res) => {
	const url = new URL(req.url ?? "/", E2E_TOOLS);
	if (url.pathname === "/dns" && req.method === "POST") {
		let body = "";
		req.on("data", (chunk: Buffer) => {
			body += chunk.toString("utf8");
		});
		req.on("end", () => {
			const entries: unknown = JSON.parse(body);
			if (Array.isArray(entries)) {
				for (const [key, values] of entries) records.set(key, values);
			}
			res.writeHead(204).end();
		});
		return;
	}
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
