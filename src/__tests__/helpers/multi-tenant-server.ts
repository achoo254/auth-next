import { randomBytes, randomUUID } from "node:crypto";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type Db, MongoClient } from "mongodb";
import { inject } from "vitest";
import { type Env, parseEnv } from "../../config/env.js";
import { createLogger } from "../../logger.js";
import { generateSigningJwk } from "../../oidc/jwks.js";
import { ensureOidcIndexes } from "../../oidc/oidc-indexes.js";
import { ensureAccountLayerIndexes } from "../../services.js";
import { parseKeyring } from "../../tenants/secret-keyring.js";
import { type Serving, createServing } from "../../tenants/serving.js";
import type { TenancyOverrides } from "../../tenants/tenancy.js";
import { ensureTenantClaimIndexes } from "../../tenants/tenant-claims.js";
import {
	type TenantDocument,
	TenantRegistry,
	ensureTenantRegistryIndexes,
	newTenantId,
} from "../../tenants/tenant-registry.js";
import { TenantSecrets } from "../../tenants/tenant-secrets.js";
import { FAKE_OAUTH_ENV } from "./fake-upstreams.js";

export const INTERNAL_SECRETS = {
	localman: "localman-internal-secret-0123456789abcdef",
	provisioner: "provisioner-internal-secret-0123456789ab",
} as const;

export interface MultiTenantServer {
	readonly origin: string;
	readonly internalOrigin: string;
	readonly env: Env;
	readonly db: Db;
	readonly serving: Serving;
	readonly registry: TenantRegistry;
	readonly secrets: TenantSecrets;
	/** Adds a registry tenant (active by default) and returns its document. */
	addTenant(
		domain: string,
		status?: TenantDocument["status"],
	): Promise<TenantDocument>;
	close(): Promise<void>;
}

function listen(server: Server, port = 0): Promise<number> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => {
			resolve((server.address() as AddressInfo).port);
		});
	});
}

/** A port free right now (the public listener must know its own port). */
async function freePort(): Promise<number> {
	const probe = createServer();
	const port = await listen(probe);
	await new Promise((resolve) => probe.close(resolve));
	return port;
}

/**
 * The real server assembly (createServing) with registry tenants enabled,
 * on random loopback ports and a fresh database. Hosts are chosen with the
 * Host header; `X-Forwarded-Proto: https` from loopback (a trusted proxy)
 * makes registry issuers https as in production.
 */
export async function startMultiTenantServer(
	extraEnv: Readonly<Record<string, string>> = {},
	overrides: TenancyOverrides = {},
): Promise<MultiTenantServer> {
	const mongoUrl = `${inject("mongoUri").replace(/\/$/, "")}/multi_${randomUUID().slice(0, 8)}`;
	const mongo = new MongoClient(mongoUrl);
	await mongo.connect();
	const db = mongo.db();
	await ensureOidcIndexes(db);
	await ensureAccountLayerIndexes(db);
	await ensureTenantRegistryIndexes(db);
	await ensureTenantClaimIndexes(db);
	const port = await freePort();
	const env = parseEnv({
		NODE_ENV: "test",
		PORT: String(port),
		ISSUER: `http://127.0.0.1:${port}`,
		MONGO_URL: mongoUrl,
		SIGNING_KEYS_PATH: "unused-in-tests.json",
		COOKIE_KEYS: randomBytes(32).toString("base64url"),
		LOCALMAN_WEB_CLIENT_SECRET: randomBytes(32).toString("base64url"),
		TUNELO_WEB_CLIENT_SECRET: randomBytes(32).toString("base64url"),
		TENANT_SECRETS_KEY: `k1:${randomBytes(32).toString("base64")}`,
		APP_CLIENT_SECRET_KEY: randomBytes(32).toString("base64url"),
		INTERNAL_API_CREDENTIALS: `localman:${INTERNAL_SECRETS.localman},provisioner:${INTERNAL_SECRETS.provisioner}`,
		LOG_LEVEL: "silent",
		...FAKE_OAUTH_ENV,
		...extraEnv,
	});
	const jwks = {
		keys: [await generateSigningJwk(), await generateSigningJwk("RS256")],
	};
	const serving = await createServing(
		env,
		db,
		jwks,
		createLogger("silent"),
		overrides,
	);
	const publicServer = createServer(serving.app);
	await listen(publicServer, port);
	const internalServer = createServer(serving.internalApp);
	const internalPort = await listen(internalServer);
	const registry = new TenantRegistry(db);
	const keyring = parseKeyring(env.TENANT_SECRETS_KEY);
	if (!keyring) throw new Error("test keyring missing");
	return {
		origin: `http://127.0.0.1:${port}`,
		internalOrigin: `http://127.0.0.1:${internalPort}`,
		env,
		db,
		serving,
		registry,
		secrets: new TenantSecrets(db, keyring),
		async addTenant(domain, status = "active") {
			const document: TenantDocument = {
				_id: newTenantId(),
				domain,
				displayName: domain.split(".")[0] ?? domain,
				status,
				createdAt: new Date(),
			};
			await registry.insert(document);
			return document;
		},
		async close() {
			await serving.stop();
			for (const server of [publicServer, internalServer]) {
				server.closeAllConnections();
				await new Promise((resolve) => server.close(resolve));
			}
			await db.dropDatabase();
			await mongo.close();
		},
	};
}

/** GET on the public listener as `host`, behind a (trusted) https proxy. */
export function getAs(
	server: MultiTenantServer,
	host: string,
	path: string,
	headers: Record<string, string> = {},
): Promise<Response> {
	return fetchAs(server.origin, host, path, { headers });
}

/** fetch with a Host header (undici forbids it, so node:http is used). */
export async function fetchAs(
	origin: string,
	host: string,
	path: string,
	init: {
		method?: string;
		headers?: Record<string, string>;
		body?: string;
	} = {},
): Promise<Response> {
	const { request } = await import("node:http");
	const url = new URL(path, origin);
	return new Promise((resolve, reject) => {
		const req = request(
			url,
			{
				method: init.method ?? "GET",
				headers: { host, "x-forwarded-proto": "https", ...init.headers },
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					const headers = new Headers();
					for (const [name, value] of Object.entries(res.headers)) {
						if (typeof value === "string") headers.set(name, value);
						else if (Array.isArray(value))
							for (const v of value) headers.append(name, v);
					}
					resolve(
						new Response(
							[204, 304].includes(res.statusCode ?? 0)
								? null
								: Buffer.concat(chunks),
							{
								status: res.statusCode ?? 0,
								headers,
							},
						),
					);
				});
			},
		);
		req.on("error", reject);
		if (init.body) req.write(init.body);
		req.end();
	});
}
