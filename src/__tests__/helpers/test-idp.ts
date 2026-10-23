import { randomBytes, randomUUID } from "node:crypto";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { RequestHandler } from "express";
import { type Db, MongoClient } from "mongodb";
import type Provider from "oidc-provider";
import { inject } from "vitest";
import { AccountRepository } from "../../accounts/account-repository.js";
import { createApp } from "../../app.js";
import { AuditOutbox } from "../../audit/audit-outbox.js";
import { type Env, parseEnv } from "../../config/env.js";
import { createLogger } from "../../logger.js";
import {
	type AccountProfile,
	createInMemoryAccountStore,
} from "../../oidc/claims.js";
import { type SigningJwks, generateSigningJwk } from "../../oidc/jwks.js";
import { ensureOidcIndexes } from "../../oidc/oidc-indexes.js";
import { createProvider } from "../../oidc/provider.js";
import {
	type AppServices,
	createServices,
	ensureAccountLayerIndexes,
} from "../../services.js";
import {
	envClientSecrets,
	envMiuClients,
	envScribeClients,
	envTenant,
} from "../../tenants/env-tenant.js";
import type { Tenant } from "../../tenants/tenant.js";
import { createAutoInteractions } from "./auto-interactions.js";
import {
	FAKE_OAUTH_ENV,
	type FakeUpstreams,
	sharedFakeUpstreams,
} from "./fake-upstreams.js";
import { PRIMARY_APP_TEST_ENV } from "./primary-app-test-env.js";
import type { TestIdpOptions } from "./test-idp-options.js";
import { withTenant } from "./test-tenant.js";

export type { TestIdpOptions };
export * from "./primary-app-test-env.js";

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
export const CHAT_WEB_SECRET = randomBytes(32).toString("base64url");
export const LOCALMAN_CALLBACK = "https://localman.hoandat.com/auth/callback";

/** localman-web's redirect URI at `idp` (LOCALMAN_CALLBACK for the primary tenant). */
export function localmanCallbackOf(idp: { readonly tenant: Tenant }): string {
	return new URL("/auth/callback", idp.tenant.webApps.localman).href;
}

export interface TestIdp {
	readonly issuer: string;
	readonly tenant: Tenant;
	readonly env: Env;
	readonly provider: Provider;
	readonly db: Db;
	readonly jwks: SigningJwks;
	readonly services: AppServices;
	/** Google, GitHub and Telegram for this process (see sharedFakeUpstreams). */
	readonly fake: FakeUpstreams;
	close(): Promise<void>;
}

function resolveInteractions(
	choice: TestIdpOptions["interactions"],
	provider: Provider,
): RequestHandler | undefined {
	if (choice === "auto")
		return createAutoInteractions(provider, TEST_ACCOUNT.sub);
	return choice === "real" ? undefined : choice;
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
	const mongoUrl =
		options.mongoUrl ??
		`${inject("mongoUri").replace(/\/$/, "")}/auth_${randomUUID().slice(0, 8)}`;
	const mongo = new MongoClient(mongoUrl, {
		monitorCommands: options.onMongoCommand !== undefined,
	});
	if (options.onMongoCommand)
		mongo.on("commandStarted", options.onMongoCommand);
	await mongo.connect();
	const db = mongo.db();
	await ensureOidcIndexes(db);
	await ensureAccountLayerIndexes(db);

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
		CHAT_WEB_CLIENT_SECRET: CHAT_WEB_SECRET,
		...PRIMARY_APP_TEST_ENV,
		LOG_LEVEL: "silent",
		...(options.withoutUpstreams ? {} : FAKE_OAUTH_ENV),
		...options.env,
	});
	// As in production: the first ES256 key signs, a second one is published
	// for verification, and an RSA key signs ID tokens of RS256 clients.
	const jwks: SigningJwks = {
		keys: [
			await generateSigningJwk(),
			await generateSigningJwk(),
			await generateSigningJwk("RS256"),
		],
	};
	const logger = createLogger(env.LOG_LEVEL);
	const tenant = withTenant(envTenant(env), options.tenant);
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
		accountStore:
			options.interactions === "real"
				? accounts
				: createInMemoryAccountStore([TEST_ACCOUNT]),
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
		formPostsPerMinute: options.formPostsPerMinute ?? 1_000,
		pushSender: options.pushSender,
		accountApiLimits: options.accountApiLimits ?? {
			perIp: 10_000,
			perAccount: 10_000,
			sensitivePerAccount: 10_000,
		},
	});
	const app = createApp({
		services,
		env,
		rateLimits: options.rateLimits,
		interactions: resolveInteractions(options.interactions, provider),
	});
	server.on("request", app);

	return {
		issuer,
		tenant,
		env,
		provider,
		db,
		jwks,
		services,
		fake: sharedFakeUpstreams(),
		close: async () => {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			// A shared database belongs to whoever created it.
			if (!options.mongoUrl) await db.dropDatabase();
			await mongo.close();
		},
	};
}
