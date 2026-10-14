import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnv } from "../config/env.js";
import {
	DEVICE_CODE_GRANT,
	STATIC_CLIENT_IDS,
	TOKEN_EXCHANGE_GRANT,
	buildStaticClients,
} from "../oidc/clients.js";
import { envClientSecrets, envTenant } from "../tenants/env-tenant.js";
import { resourcesFor } from "../tenants/tenant-resources.js";
import { discoverClient, runCodeFlow } from "./helpers/flows.js";
import {
	LOCALMAN_CALLBACK,
	LOCALMAN_WEB_SECRET,
	TUNELO_WEB_SECRET,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";
import { RESOURCES } from "./helpers/test-tenant.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "auto", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

/** The client as oidc-provider validated and normalised it. */
async function metadataOf(clientId: string): Promise<Record<string, unknown>> {
	const found = await idp.provider.Client.find(clientId);
	if (!found) throw new Error(`${clientId} is not configured`);
	return found.metadata();
}

function scopes(metadata: Record<string, unknown>): string[] {
	return String(metadata.scope).split(" ").sort();
}

describe("static clients match the integration contract", () => {
	it("derives production URIs from the default app URLs", () => {
		const env = parseEnv({
			MONGO_URL: "mongodb://127.0.0.1:27017/auth",
			SIGNING_KEYS_PATH: "unused.json",
			COOKIE_KEYS: "k".repeat(32),
			LOCALMAN_WEB_CLIENT_SECRET: "l".repeat(32),
			TUNELO_WEB_CLIENT_SECRET: "t".repeat(32),
			CHAT_WEB_CLIENT_SECRET: "c".repeat(32),
		});
		const byId = new Map(
			buildStaticClients(
				envTenant(env),
				resourcesFor(env.TENANT_DOMAIN),
				envClientSecrets(env),
			).map((entry) => [entry.client_id, entry]),
		);
		expect(byId.get(STATIC_CLIENT_IDS.localmanWeb)).toMatchObject({
			redirect_uris: ["https://localman.hoandat.com/auth/callback"],
			backchannel_logout_uri:
				"https://localman.hoandat.com/auth/backchannel-logout",
			backchannel_logout_session_required: true,
		});
		expect(byId.get(STATIC_CLIENT_IDS.tuneloWeb)).toMatchObject({
			redirect_uris: ["https://tunnel.hoandat.com/auth/callback"],
			backchannel_logout_uri:
				"https://tunnel.hoandat.com/auth/backchannel-logout",
			backchannel_logout_session_required: true,
		});
	});

	it("localman-web: confidential code client that alone may exchange tokens", async () => {
		const metadata = await metadataOf(STATIC_CLIENT_IDS.localmanWeb);
		expect(metadata).toMatchObject({
			token_endpoint_auth_method: "client_secret_basic",
			grant_types: [
				"authorization_code",
				"refresh_token",
				TOKEN_EXCHANGE_GRANT,
			],
			allowed_resources: [RESOURCES.localman],
		});
		// Its refresh tokens are bound to the IdP session, never offline.
		expect(scopes(metadata)).not.toContain("offline_access");
		expect(scopes(await metadataOf(STATIC_CLIENT_IDS.tuneloWeb))).not.toContain(
			"offline_access",
		);
		for (const id of [
			STATIC_CLIENT_IDS.tuneloCli,
			STATIC_CLIENT_IDS.tuneloWeb,
			STATIC_CLIENT_IDS.accountPortal,
		]) {
			expect((await metadataOf(id)).grant_types).not.toContain(
				TOKEN_EXCHANGE_GRANT,
			);
		}
	});

	it("tunelo-cli: public device client for the Tunelo audience", async () => {
		const metadata = await metadataOf(STATIC_CLIENT_IDS.tuneloCli);
		expect(metadata).toMatchObject({
			token_endpoint_auth_method: "none",
			grant_types: [DEVICE_CODE_GRANT, "refresh_token"],
			allowed_resources: [RESOURCES.tunnel],
		});
		expect(scopes(metadata)).toEqual([
			"offline_access",
			"openid",
			"tunnels:open",
			"tunnels:read",
		]);
	});

	it("tunelo-web and hoandat-account", async () => {
		expect(await metadataOf(STATIC_CLIENT_IDS.tuneloWeb)).toMatchObject({
			token_endpoint_auth_method: "client_secret_basic",
			allowed_resources: [RESOURCES.tunnel],
		});
		const portal = await metadataOf(STATIC_CLIENT_IDS.accountPortal);
		expect(portal).toMatchObject({
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code"],
			scope: "openid",
			allowed_resources: [],
		});
	});

	it("advertises back-channel logout and token exchange", async () => {
		const response = await fetch(
			`${idp.issuer}/.well-known/openid-configuration`,
		);
		const discovery: unknown = await response.json();
		expect(discovery).toMatchObject({
			backchannel_logout_supported: true,
			backchannel_logout_session_supported: true,
			grant_types_supported: expect.arrayContaining([
				DEVICE_CODE_GRANT,
				TOKEN_EXCHANGE_GRANT,
			]),
		});
	});

	it("never lets a dynamically registered client exchange tokens", async () => {
		await expect(
			client.dynamicClientRegistration(
				new URL(idp.issuer),
				{
					redirect_uris: ["http://127.0.0.1:33418/callback"],
					token_endpoint_auth_method: "none",
					grant_types: ["authorization_code", TOKEN_EXCHANGE_GRANT],
				},
				client.None(),
				{ execute: [client.allowInsecureRequests] },
			),
		).rejects.toMatchObject({ error: "invalid_client_metadata" });
	});

	it("lets a client revoke only its own tokens", async () => {
		const localman = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.localmanWeb,
			client.ClientSecretBasic(LOCALMAN_WEB_SECRET),
		);
		const tunelo = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.tuneloWeb,
			client.ClientSecretBasic(TUNELO_WEB_SECRET),
		);
		const { tokens } = await runCodeFlow(localman, LOCALMAN_CALLBACK, {
			scope: "openid",
		});
		await client.tokenRevocation(tunelo, tokens.access_token);
		expect(
			await client.tokenIntrospection(localman, tokens.access_token),
		).toMatchObject({ active: true });
		await client.tokenRevocation(localman, tokens.access_token);
		expect(
			await client.tokenIntrospection(localman, tokens.access_token),
		).toMatchObject({ active: false });
	});
});
