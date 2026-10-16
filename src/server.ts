import { setDefaultResultOrder } from "node:dns";
import type { Server } from "node:http";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import type { Express } from "express";
import type { MongoClient } from "mongodb";
import { type Env, parseEnv } from "./config/env.js";
import { auditDeliveryConfig } from "./config/integrations-env.js";
import { connectMongo } from "./db/connect-mongo.js";
import { type Logger, createLogger } from "./logger.js";
import {
	loadSigningJwks,
	primarySigningKey,
	rsaSigningKey,
} from "./oidc/jwks.js";
import { ensureOidcIndexes } from "./oidc/oidc-indexes.js";
import { ensureAccountLayerIndexes } from "./services.js";
import { type Serving, createServing } from "./tenants/serving.js";
import { ensureTenantClaimIndexes } from "./tenants/tenant-claims.js";
import { migrateToTenants } from "./tenants/tenant-migration.js";
import { ensureTenantRegistryIndexes } from "./tenants/tenant-registry.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;
/**
 * Per-address connect budget of Node's happy eyeballs (default 250 ms).
 * From the production host IPv6 to api.telegram.org is dead and IPv4 needs
 * about 290 ms to connect, so the default aborted most Telegram sends
 * (link confirmations included) with ETIMEDOUT.
 */
const CONNECT_ATTEMPT_TIMEOUT_MS = 1_000;

setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT_MS);
/**
 * The production host learns an IPv6 default route from router adverts but
 * has no global IPv6 address, so every IPv6 connect dies. Hosts behind
 * Cloudflare answer AAAA first, and with the default "verbatim" order the
 * back-channel logout POSTs (2.5 s budget) and audit deliveries timed out
 * before happy eyeballs reached IPv4 (2026-10-16). Resolve IPv4 first.
 */
setDefaultResultOrder("ipv4first");

function loadEnvOrExit(): Env {
	try {
		return parseEnv(process.env);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		createLogger("info").fatal(message);
		process.exit(1);
	}
}

function listen(app: Express, host: string, port: number): Promise<Server> {
	return new Promise((resolve, reject) => {
		const server = app.listen(port, host);
		server.once("error", reject);
		server.once("listening", () => {
			server.off("error", reject);
			resolve(server);
		});
	});
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
		server.closeIdleConnections();
	});
}

const env = loadEnvOrExit();
const logger: Logger = createLogger(env.LOG_LEVEL);
let server: Server | undefined;
let internalServer: Server | undefined;
let mongo: MongoClient | undefined;
let serving: Serving | undefined;
let shuttingDown = false;

async function shutdown(reason: string, exitCode: number): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	logger.info({ reason }, "Shutting down");
	const forceExit = setTimeout(() => {
		logger.error("Graceful shutdown timed out; forcing exit");
		process.exit(1);
	}, SHUTDOWN_TIMEOUT_MS);
	forceExit.unref();
	try {
		if (server) await closeServer(server);
		if (internalServer) await closeServer(internalServer);
		// Stops before MongoDB closes; an attempt in flight is handed back.
		if (serving) await serving.stop();
		if (mongo) await mongo.close();
		logger.info("Shutdown complete");
		process.exit(exitCode);
	} catch (error) {
		logger.error({ err: error }, "Shutdown failed");
		process.exit(1);
	}
}

process.once("SIGTERM", () => void shutdown("SIGTERM", 0));
process.once("SIGINT", () => void shutdown("SIGINT", 0));
process.on("unhandledRejection", (reason) => {
	logger.fatal({ err: reason }, "Unhandled promise rejection");
	void shutdown("unhandledRejection", 1);
});
process.on("uncaughtException", (error) => {
	logger.fatal({ err: error }, "Uncaught exception");
	void shutdown("uncaughtException", 1);
});

// Fail fast: without signing keys or MongoDB the IdP cannot issue anything,
// and the supervisor (Compose) restarts the process once they are back.
try {
	const jwks = await loadSigningJwks(env.SIGNING_KEYS_PATH);
	logger.info(
		{
			signingKid: primarySigningKey(jwks).kid,
			rs256Kid: rsaSigningKey(jwks)?.kid,
			keyCount: jwks.keys.length,
		},
		"Signing keys loaded",
	);
	const connection = await connectMongo(env.MONGO_URL, logger);
	mongo = connection.client;
	await ensureOidcIndexes(connection.db);
	await ensureAccountLayerIndexes(connection.db);
	await ensureTenantRegistryIndexes(connection.db);
	await ensureTenantClaimIndexes(connection.db);
	await migrateToTenants(connection.db, logger);
	serving = await createServing(env, connection.db, jwks, logger);
	const { services } = serving.primary;
	logger.info(
		{
			upstreams: [...services.upstreams.keys()],
			telegram: services.telegram !== undefined,
		},
		"Sign-in integrations",
	);
	const delivery = auditDeliveryConfig(env);
	logger.info(
		{ auditDelivery: delivery ? new URL(delivery.url).origin : "outbox only" },
		"Audit events",
	);
	server = await listen(serving.app, env.HOST, env.PORT);
	if (serving.internalApp) {
		internalServer = await listen(
			serving.internalApp,
			env.INTERNAL_HOST,
			env.INTERNAL_PORT,
		);
	}
	serving.start();
	logger.info(
		{
			host: env.HOST,
			port: env.PORT,
			issuer: serving.primary.tenant.issuer,
			internalApi: serving.internalApp
				? `${env.INTERNAL_HOST}:${env.INTERNAL_PORT}`
				: "off",
			tenants: env.TENANT_SECRETS_KEY ? "registry" : "primary only",
		},
		"hoandat-auth listening",
	);
} catch (error) {
	logger.fatal({ err: error }, "Startup failed");
	await shutdown("startup failure", 1);
}
