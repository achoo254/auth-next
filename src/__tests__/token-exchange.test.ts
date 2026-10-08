import { decodeJwt } from "jose";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STATIC_CLIENT_IDS, TOKEN_EXCHANGE_GRANT } from "../oidc/clients.js";
import { RESOURCES } from "../oidc/resources.js";
import { ACCESS_TOKEN_TYPE } from "../oidc/token-exchange-request.js";
import {
	exchange,
	localmanWeb,
	rejectedWith,
	signInToLocalman,
	tuneloWeb,
} from "./helpers/exchange-flows.js";
import { discoverClient } from "./helpers/flows.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { createAccessTokenVerifier } from "./helpers/verify-access-token.js";

let idp: TestIdp;
let localman: client.Configuration;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
	localman = await localmanWeb(idp);
});

afterAll(async () => {
	await idp?.close();
});

function signIn() {
	return signInToLocalman(idp);
}

describe("token exchange for localman-web", () => {
	it("is advertised in discovery", () => {
		expect(localman.serverMetadata().grant_types_supported ?? []).toContain(
			TOKEN_EXCHANGE_GRANT,
		);
	});

	it("issues a short-lived tunnels:read JWT for Tunelo, acting for the user", async () => {
		const { accountId, subject } = await signIn();
		const response = await exchange(localman, subject);
		expect(response).toMatchObject({
			issued_token_type: ACCESS_TOKEN_TYPE,
			token_type: "bearer",
			scope: "tunnels:read",
		});
		expect(response.refresh_token).toBeUndefined();
		expect(response.id_token).toBeUndefined();
		expect(response.expires_in).toBeLessThanOrEqual(15 * 60);

		const verify = createAccessTokenVerifier({
			issuer: idp.issuer,
			audience: RESOURCES.tunnel,
			jwksUri: `${idp.issuer}/jwks`,
		});
		const claims = await verify(response.access_token);
		expect(claims).toMatchObject({
			sub: accountId,
			aud: RESOURCES.tunnel,
			scope: "tunnels:read",
			client_id: STATIC_CLIENT_IDS.localmanWeb,
			azp: STATIC_CLIENT_IDS.localmanWeb,
			act: { sub: STATIC_CLIENT_IDS.localmanWeb },
		});
		expect(Number(claims.exp) - Number(claims.iat)).toBeLessThanOrEqual(900);

		const localmanVerify = createAccessTokenVerifier({
			issuer: idp.issuer,
			audience: RESOURCES.localman,
			jwksUri: `${idp.issuer}/jwks`,
		});
		await expect(localmanVerify(response.access_token)).rejects.toThrow();
	});

	it("defaults the scope and accepts `audience` instead of `resource`", async () => {
		const { subject } = await signIn();
		const response = await exchange(localman, subject, {
			scope: undefined,
			resource: undefined,
			audience: RESOURCES.tunnel,
		});
		expect(decodeJwt(response.access_token)).toMatchObject({
			aud: RESOURCES.tunnel,
			scope: "tunnels:read",
		});
	});
});

describe("token exchange refuses", () => {
	it("every other client with unauthorized_client", async () => {
		const { subject } = await signIn();
		const cli = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.tuneloCli,
			client.None(),
		);
		for (const config of [await tuneloWeb(idp), cli]) {
			await expect(exchange(config, subject)).rejects.toMatchObject(
				rejectedWith("unauthorized_client"),
			);
		}
	});

	it("localman-web with a wrong secret (invalid_client)", async () => {
		const { subject } = await signIn();
		const forged = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.localmanWeb,
			client.ClientSecretBasic("not-the-secret-of-localman-web-at-all"),
		);
		// A 401 with the error in the WWW-Authenticate challenge.
		await expect(exchange(forged, subject)).rejects.toMatchObject({
			status: 401,
			cause: [{ parameters: { error: "invalid_client" } }],
		});
	});

	it("any scope but tunnels:read (invalid_scope)", async () => {
		const { subject } = await signIn();
		for (const scope of [
			"tunnels:open",
			"tunnels:read tunnels:open",
			"openid",
			"mock:read",
		]) {
			await expect(
				exchange(localman, subject, { scope }),
			).rejects.toMatchObject(rejectedWith("invalid_scope"));
		}
	});

	it("any target but Tunelo (invalid_target) and a missing one", async () => {
		const { subject } = await signIn();
		for (const overrides of [
			{ resource: RESOURCES.localman },
			{ resource: RESOURCES.localmanMcp },
			{ resource: undefined, audience: "https://evil.example" },
			{ audience: RESOURCES.localman },
		]) {
			await expect(
				exchange(localman, subject, overrides),
			).rejects.toMatchObject(rejectedWith("invalid_target"));
		}
		await expect(
			exchange(localman, subject, { resource: undefined }),
		).rejects.toMatchObject(rejectedWith("invalid_request"));
	});

	it("other token types and actor tokens (invalid_request)", async () => {
		const { subject } = await signIn();
		for (const overrides of [
			{ subject_token_type: "urn:ietf:params:oauth:token-type:id_token" },
			{ subject_token_type: undefined },
			{
				requested_token_type: "urn:ietf:params:oauth:token-type:refresh_token",
			},
			{ actor_token: subject, actor_token_type: ACCESS_TOKEN_TYPE },
		]) {
			await expect(
				exchange(localman, subject, overrides),
			).rejects.toMatchObject(rejectedWith("invalid_request"));
		}
	});
});
