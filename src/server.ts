import type { Server } from "node:http";
import type { Express } from "express";
import type { MongoClient } from "mongodb";
import { AccountRepository } from "./accounts/account-repository.js";
import { createApp } from "./app.js";
import { type Env, parseEnv } from "./config/env.js";
import { connectMongo } from "./db/connect-mongo.js";
import { type Logger, createLogger } from "./logger.js";
import { loadSigningJwks } from "./oidc/jwks.js";
import { ensureOidcIndexes } from "./oidc/mongo-adapter.js";
import { createProvider } from "./oidc/provider.js";
import { createServices, ensureAccountLayerIndexes } from "./services.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

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
let mongo: MongoClient | undefined;
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
		{ signingKid: jwks.keys[0]?.kid, keyCount: jwks.keys.length },
		"Signing keys loaded",
	);
	const connection = await connectMongo(env.MONGO_URL, logger);
	mongo = connection.client;
	await ensureOidcIndexes(connection.db);
	await ensureAccountLayerIndexes(connection.db);
	const accounts = new AccountRepository(connection.db);
	const provider = createProvider({
		env,
		db: connection.db,
		jwks,
		accountStore: accounts,
		logger,
	});
	const services = createServices({
		env,
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
	server = await listen(createApp({ services, env }), env.HOST, env.PORT);
	logger.info(
		{ host: env.HOST, port: env.PORT, issuer: env.ISSUER },
		"hoandat-auth listening",
	);
} catch (error) {
	logger.fatal({ err: error }, "Startup failed");
	await shutdown("startup failure", 1);
}
