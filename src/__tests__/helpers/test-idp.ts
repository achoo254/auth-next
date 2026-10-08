import { randomBytes, randomUUID } from "node:crypto";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { RequestHandler } from "express";
import { type Db, MongoClient } from "mongodb";
import type Provider from "oidc-provider";
import { inject } from "vitest";
import { createApp } from "../../app.js";
import { type Env, parseEnv } from "../../config/env.js";
import type { RateLimitRule } from "../../http/security.js";
import { createLogger } from "../../logger.js";
import {
	type AccountProfile,
	createInMemoryAccountStore,
} from "../../oidc/claims.js";
import { type SigningJwks, generateSigningJwk } from "../../oidc/jwks.js";
import { ensureOidcIndexes } from "../../oidc/mongo-adapter.js";
import { createProvider } from "../../oidc/provider.js";
import { createAutoInteractions } from "./auto-interactions.js";

export const TEST_ACCOUNT: AccountProfile = {
	sub: "acc_test_1",
	username: "hoandat",
	email: "hoandat@example.com",
	emailVerified: false,
	name: "Hoan Dat",
	picture: "https://example.com/avatar.png",
	telegramLinked: true,
};

export const LOCALMAN_WEB_SECRET = randomBytes(32).toString("base64url");
export const TUNELO_WEB_SECRET = randomBytes(32).toString("base64url");
export const LOCALMAN_CALLBACK = "https://localman.hoandat.com/auth/callback";

export interface TestIdp {
	readonly issuer: string;
	readonly env: Env;
	readonly provider: Provider;
	readonly db: Db;
	readonly jwks: SigningJwks;
	close(): Promise<void>;
}

export interface TestIdpOptions {
	/**
	 * "auto" signs TEST_ACCOUNT in; "placeholder" keeps the production 501; a
	 * handler replaces both.
	 */
	readonly interactions: "auto" | "placeholder" | RequestHandler;
	readonly rateLimits?: readonly RateLimitRule[];
}

function resolveInteractions(
	choice: TestIdpOptions["interactions"],
	provider: Provider,
): RequestHandler | undefined {
	if (choice === "auto")
		return createAutoInteractions(provider, TEST_ACCOUNT.sub);
	return choice === "placeholder" ? undefined : choice;
}

function listenOnRandomPort(server: Server): Promise<number> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			resolve((server.address() as AddressInfo).port);
		});
	});
}

/**
 * Boots the real app (security layer, provider, Mongo adapter) on a random
 * port against a fresh database of the shared in-memory mongod.
 */
export async function startTestIdp(options: TestIdpOptions): Promise<TestIdp> {
	const mongoUrl = `${inject("mongoUri").replace(/\/$/, "")}/auth_${randomUUID().slice(0, 8)}`;
	const mongo = new MongoClient(mongoUrl);
	await mongo.connect();
	const db = mongo.db();
	await ensureOidcIndexes(db);

	const server = createServer();
	const port = await listenOnRandomPort(server);
	const issuer = `http://127.0.0.1:${port}`;
	const env = parseEnv({
		NODE_ENV: "test",
		ISSUER: issuer,
		MONGO_URL: mongoUrl,
		SIGNING_KEYS_PATH: "unused-in-tests.json",
		COOKIE_KEYS: randomBytes(32).toString("base64url"),
		LOCALMAN_WEB_CLIENT_SECRET: LOCALMAN_WEB_SECRET,
		TUNELO_WEB_CLIENT_SECRET: TUNELO_WEB_SECRET,
		LOG_LEVEL: "silent",
	});
	// Two keys: the first signs, the second is published for verification.
	const jwks: SigningJwks = {
		keys: [await generateSigningJwk(), await generateSigningJwk()],
	};
	const logger = createLogger(env.LOG_LEVEL);
	const provider = createProvider({
		env,
		db,
		jwks,
		accountStore: createInMemoryAccountStore([TEST_ACCOUNT]),
		logger,
	});
	const app = createApp({
		provider,
		logger,
		env,
		rateLimits: options.rateLimits,
		interactions: resolveInteractions(options.interactions, provider),
	});
	server.on("request", app);

	return {
		issuer,
		env,
		provider,
		db,
		jwks,
		close: async () => {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await db.dropDatabase();
			await mongo.close();
		},
	};
}
