import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInMemoryAccountStore } from "../oidc/claims.js";
import { checkDiscovery } from "../oidc/client-seed.js";
import { generateSigningJwk } from "../oidc/jwks.js";
import { buildProviderConfiguration } from "../oidc/provider.js";
import { envClientSecrets } from "../tenants/env-tenant.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

const CLIENT = {
	client_id: "rs256-app",
	client_secret: "a-secret-long-enough-for-the-test-client",
	redirect_uris: ["https://app.example/callback"],
};

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "auto" });
});

afterAll(async () => {
	await idp?.close();
});

describe("ID token signing algorithms", () => {
	it("accepts a client that registers RS256 ID tokens", async () => {
		await expect(
			idp.provider.Client.validate({
				...CLIENT,
				id_token_signed_response_alg: "RS256",
			}),
		).resolves.toBeUndefined();
	});

	it("keeps ES256 as the default and offers RS256 beside it", () => {
		const configuration = buildProviderConfiguration({
			tenant: idp.tenant,
			cookieKeys: idp.env.COOKIE_KEYS,
			chatMobileRedirectUri: idp.env.CHAT_MOBILE_REDIRECT_URI,
			clientSecrets: envClientSecrets(idp.env),
			db: idp.db,
			jwks: idp.jwks,
			accountStore: createInMemoryAccountStore([]),
		});
		expect(configuration.clientDefaults?.id_token_signed_response_alg).toBe(
			"ES256",
		);
		expect(configuration.enabledJWA?.idTokenSigningAlgValues).toEqual([
			"ES256",
			"RS256",
		]);
	});

	it("refuses algorithms it has no key for", async () => {
		await expect(
			idp.provider.Client.validate({
				...CLIENT,
				id_token_signed_response_alg: "PS256",
			}),
		).rejects.toMatchObject({
			error: "invalid_client_metadata",
			error_description: expect.stringContaining(
				"id_token_signed_response_alg",
			),
		});
	});

	it("offers RS256 only when the key set holds an RSA key", async () => {
		const configuration = buildProviderConfiguration({
			tenant: idp.tenant,
			cookieKeys: idp.env.COOKIE_KEYS,
			chatMobileRedirectUri: idp.env.CHAT_MOBILE_REDIRECT_URI,
			clientSecrets: envClientSecrets(idp.env),
			db: idp.db,
			jwks: { keys: [await generateSigningJwk()] },
			accountStore: createInMemoryAccountStore([]),
		});
		expect(configuration.enabledJWA?.idTokenSigningAlgValues).toEqual([
			"ES256",
		]);
	});

	it("flags a deployment whose discovery does not offer RS256", async () => {
		const fakeFetch: typeof fetch = async (input) =>
			Response.json(
				String(input).endsWith("/jwks")
					? { keys: [{ kid: "k1" }] }
					: {
							issuer: "https://idp.example",
							grant_types_supported: [
								"refresh_token",
								"urn:ietf:params:oauth:grant-type:token-exchange",
							],
							device_authorization_endpoint: "https://idp.example/device",
							backchannel_logout_supported: true,
							id_token_signing_alg_values_supported: ["ES256"],
							jwks_uri: "https://idp.example/jwks",
						},
			);
		expect(
			await checkDiscovery("https://idp.example", ["k1"], fakeFetch),
		).toEqual(["RS256 missing"]);
	});
});
