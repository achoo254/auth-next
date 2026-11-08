import { decodeJwt } from "jose";
import * as client from "openid-client";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { DEVICE_CODE_GRANT, STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import { approveDevice, discoverClient } from "./helpers/flows.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { RESOURCES } from "./helpers/test-tenant.js";

const AGENT = STATIC_CLIENT_IDS.tuneloAgent;
const DAY_MS = 24 * 60 * 60 * 1000;
const SCOPE =
	"openid offline_access tunnels:open tunnels:read chat:read chat:write machines:write mock:read mock:write client:read client:write client:send";
const { tunnel, chatMcp, localmanMcp } = RESOURCES;

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "auto" });
});

afterAll(async () => {
	await idp?.close();
});

afterEach(() => {
	vi.useRealTimers();
});

function claimsOf(accessToken: string): { aud: unknown; scope: unknown } {
	const { aud, scope, client_id } = decodeJwt(accessToken);
	expect(client_id).toBe(AGENT);
	return { aud, scope };
}

async function grantIdOf(refreshToken: string): Promise<string | undefined> {
	const doc = await idp.db
		.collection<{ _id: string; grantId?: string }>(
			collectionNameFor("RefreshToken"),
		)
		.findOne({ _id: refreshToken });
	return doc?.grantId;
}

/** The agent signs in "now" for `resources`; the token is for the tunnel. */
async function agentLogin(resources: readonly string[]): Promise<{
	config: client.Configuration;
	tokens: client.TokenEndpointResponse;
	start: number;
}> {
	const start = Date.now();
	vi.useFakeTimers({ toFake: ["Date"], now: start });
	const config = await discoverClient(idp, AGENT, client.None());
	const body = new URLSearchParams({ scope: SCOPE });
	for (const resource of resources) body.append("resource", resource);
	const authorization = await client.initiateDeviceAuthorization(config, body);
	const page = await approveDevice(
		authorization.verification_uri,
		authorization.user_code,
	);
	expect(page.status).toBe(200);
	const tokens = await client.genericGrantRequest(config, DEVICE_CODE_GRANT, {
		device_code: authorization.device_code,
		resource: tunnel,
	});
	return { config, tokens, start };
}

/** Error code of a refresh, or "accepted". */
function refreshOutcome(
	config: client.Configuration,
	refreshToken: string,
	resource: string,
): Promise<string> {
	return client
		.refreshTokenGrant(config, refreshToken, { resource })
		.then(() => "accepted")
		.catch((error: { error?: string }) => error.error ?? "error");
}

describe("one tunelo-agent grant, three resources", () => {
	it("refreshes into tokens for each resource, rotating within one grant past 90 days", async () => {
		const { config, tokens, start } = await agentLogin([
			tunnel,
			chatMcp,
			localmanMcp,
		]);
		expect(claimsOf(tokens.access_token)).toEqual({
			aud: tunnel,
			scope: "tunnels:open tunnels:read",
		});
		const steps: readonly [number, string, string][] = [
			[29, chatMcp, "chat:read chat:write machines:write"],
			[
				58,
				localmanMcp,
				"mock:read mock:write client:read client:write client:send machines:write",
			],
			[87, tunnel, "tunnels:open tunnels:read"],
			// Past the 90-day cap of other clients: the device grant slides on.
			[116, chatMcp, "chat:read chat:write machines:write"],
		];
		const refreshTokens = [tokens.refresh_token ?? ""];
		for (const [day, resource, scope] of steps) {
			vi.setSystemTime(start + day * DAY_MS);
			const next = await client.refreshTokenGrant(
				config,
				refreshTokens.at(-1) ?? "",
				{ resource },
			);
			const claims = claimsOf(next.access_token);
			expect(claims.aud).toBe(resource);
			expect(String(claims.scope).split(" ").sort()).toEqual(
				scope.split(" ").sort(),
			);
			refreshTokens.push(next.refresh_token ?? "");
		}
		expect(new Set(refreshTokens).size).toBe(refreshTokens.length);
		const grantId = await grantIdOf(refreshTokens[0] ?? "");
		expect(grantId).toEqual(expect.any(String));
		const grants = await Promise.all(refreshTokens.slice(1).map(grantIdOf));
		expect(grants.every((id) => id === grantId)).toBe(true);
		const grantDocs = idp.db.collection<{ _id: string; expiresAt?: Date }>(
			collectionNameFor("Grant"),
		);
		const grant = await grantDocs.findOne({ _id: grantId ?? "" });
		expect(grant?.expiresAt?.getTime()).toBeGreaterThan(
			start + (116 + 30) * DAY_MS - 2_000,
		);
	});

	// A refused refresh still spends its refresh token (oidc-provider consumes
	// it first): the agent must name only resources of its device login, or
	// sign in again.
	it("refuses a resource that was not part of the device login, spending the refresh token", async () => {
		const { config, tokens } = await agentLogin([tunnel]);
		expect(
			await refreshOutcome(config, tokens.refresh_token ?? "", chatMcp),
		).toBe("invalid_target");
		expect(
			await refreshOutcome(config, tokens.refresh_token ?? "", tunnel),
		).toBe("invalid_grant");
	});

	it("refuses a resource outside its allowed list, spending the refresh token", async () => {
		const { config, tokens } = await agentLogin([tunnel, chatMcp, localmanMcp]);
		expect(
			await refreshOutcome(
				config,
				tokens.refresh_token ?? "",
				RESOURCES.scribeMcp,
			),
		).toBe("invalid_target");
		expect(
			await refreshOutcome(config, tokens.refresh_token ?? "", tunnel),
		).toBe("invalid_grant");
	});

	it("revokes the whole grant when a rotated refresh token is replayed", async () => {
		const { config, tokens } = await agentLogin([tunnel, chatMcp, localmanMcp]);
		const first = tokens.refresh_token ?? "";
		const next = await client.refreshTokenGrant(config, first, {
			resource: chatMcp,
		});
		expect(await refreshOutcome(config, first, localmanMcp)).toBe(
			"invalid_grant",
		);
		expect(
			await refreshOutcome(config, next.refresh_token ?? "", localmanMcp),
		).toBe("invalid_grant");
	});
});
