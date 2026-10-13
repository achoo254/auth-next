import type { Server } from "node:http";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import type { Express } from "express";
import type { MongoClient } from "mongodb";
import { AccountRepository } from "./accounts/account-repository.js";
import { createApp } from "./app.js";
import { AuditDispatcher } from "./audit/audit-dispatcher.js";
import { AuditOutbox } from "./audit/audit-outbox.js";
import { createSecurityEventSigner } from "./audit/security-event-token.js";
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
import { createProvider } from "./oidc/provider.js";
import { createServices, ensureAccountLayerIndexes } from "./services.js";
import { envClientSecrets, envTenant } from "./tenants/env-tenant.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;
/**
 * Per-address connect budget of Node's happy eyeballs (default 250 ms).
 * From the production host IPv6 to api.telegram.org is dead and IPv4 needs
 * about 290 ms to connect, so the default aborted most Telegram sends
 * (link confirmations included) with ETIMEDOUT.
 */
const CONNECT_ATTEMPT_TIMEOUT_MS = 1_000;

setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT_MS);

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
const tenant = envTenant(env);
const logger: Logger = createLogger(env.LOG_LEVEL);
let server: Server | undefined;
let mongo: MongoClient | undefined;
let auditDispatcher: AuditDispatcher | undefined;
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
		// Stops before MongoDB closes; an attempt in flight is handed back.
		if (auditDispatcher) await auditDispatcher.stop();
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
	const accounts = new AccountRepository(
		connection.db,
		tenant,
		new AuditOutbox(connection.db, tenant, logger),
	);
	const provider = createProvider({
		tenant,
		db: connection.db,
		jwks,
		cookieKeys: env.COOKIE_KEYS,
		clientSecrets: envClientSecrets(env),
		accountStore: accounts,
		logger,
	});
	const services = createServices({
		env,
		tenant,
		db: connection.db,
		provider,
		logger,
		accounts,
	});
	logger.info(
		{
			upstreams: [...services.upstreams.keys()],
			telegram: services.telegram !== undefined,
		},
		"Sign-in integrations",
	);
	// Without a target the dispatcher only scrubs old events' IP/User-Agent.
	const delivery = auditDeliveryConfig(env);
	auditDispatcher = new AuditDispatcher({
		outbox: services.audit,
		delivery: delivery && {
			config: delivery,
			sign: createSecurityEventSigner({
				issuer: tenant.issuer,
				audience: delivery.url,
				jwks,
			}),
		},
		logger,
	});
	logger.info(
		{ auditDelivery: delivery ? new URL(delivery.url).origin : "outbox only" },
		"Audit events",
	);
	server = await listen(createApp({ services, env }), env.HOST, env.PORT);
	auditDispatcher?.start();
	logger.info(
		{ host: env.HOST, port: env.PORT, issuer: tenant.issuer },
		"hoandat-auth listening",
	);
} catch (error) {
	logger.fatal({ err: error }, "Startup failed");
	await shutdown("startup failure", 1);
}
