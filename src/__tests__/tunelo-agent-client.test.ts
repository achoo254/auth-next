import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	DEVICE_CODE_GRANT,
	STATIC_CLIENT_IDS,
	refreshesPerDevice,
	refreshesWithSession,
} from "../oidc/clients.js";
import {
	DCR_ALLOWED_SCOPES,
	DCR_DEFAULT_SCOPES,
} from "../oidc/registration-policy.js";
import {
	MACHINES_WRITE_SCOPE,
	SUPPORTED_SCOPES,
	createResourcePolicy,
} from "../oidc/resources.js";
import { hasHardCap } from "../oidc/sliding-grants.js";
import { discoverClient } from "./helpers/flows.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { RESOURCES } from "./helpers/test-tenant.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "auto", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

const AGENT = STATIC_CLIENT_IDS.tuneloAgent;

async function metadataOf(clientId: string): Promise<Record<string, unknown>> {
	const found = await idp.provider.Client.find(clientId);
	if (!found) throw new Error(`${clientId} is not configured`);
	return found.metadata();
}

/** Error code of a device authorization request, or "accepted". */
async function deviceAuthorization(
	clientId: string,
	scope: string,
	resources: readonly string[],
): Promise<string> {
	const config = await discoverClient(idp, clientId, client.None());
	const body = new URLSearchParams({ scope });
	for (const resource of resources) body.append("resource", resource);
	return client
		.initiateDeviceAuthorization(config, body)
		.then(() => "accepted")
		.catch((error: { error?: string }) => error.error ?? "error");
}

const THREE = [RESOURCES.tunnel, RESOURCES.chatMcp, RESOURCES.localmanMcp];

describe("tunelo-agent leaves every other client as it was", () => {
	it("keeps the DCR scopes and the scopes of tunelo-cli, tunelo-web, chat-web, localman-web", async () => {
		const scopes = async (id: string) => (await metadataOf(id)).scope;
		expect({
			dcrDefault: DCR_DEFAULT_SCOPES.join(" "),
			dcrAllowed: DCR_ALLOWED_SCOPES.join(" "),
			tuneloCli: await scopes(STATIC_CLIENT_IDS.tuneloCli),
			tuneloWeb: await scopes(STATIC_CLIENT_IDS.tuneloWeb),
			chatWeb: await scopes(STATIC_CLIENT_IDS.chatWeb),
			localmanWeb: await scopes(STATIC_CLIENT_IDS.localmanWeb),
		}).toEqual({
			dcrDefault:
				"mock:read mock:write client:read client:write client:send chat:read chat:write bots:read bots:write scribe:read",
			dcrAllowed:
				"mock:read mock:write client:read client:write client:send credentials:write chat:read chat:write bots:read bots:write bots:admin scribe:read",
			tuneloCli: "openid offline_access tunnels:open tunnels:read",
			tuneloWeb: "openid profile email tunnels:open tunnels:read",
			chatWeb: "openid profile email",
			localmanWeb:
				"openid profile email telegram mock:read mock:write client:read client:write client:send",
		});
	});

	it("gives machines:write to no other static client", async () => {
		for (const id of Object.values(STATIC_CLIENT_IDS)) {
			if (id === AGENT) continue;
			const found = await idp.provider.Client.find(id);
			if (!found) continue;
			expect(String(found.metadata().scope).split(" "), id).not.toContain(
				MACHINES_WRITE_SCOPE,
			);
		}
	});

	it("adds machines:write to the Chat and Localman MCP resources for the agent only", () => {
		const policy = createResourcePolicy(RESOURCES);
		const scopesOf = (resource: string, clientId?: string) =>
			String(policy.resourceServerInfo(resource, clientId).scope).split(" ");
		for (const resource of [RESOURCES.chatMcp, RESOURCES.localmanMcp]) {
			expect(scopesOf(resource, AGENT)).toContain(MACHINES_WRITE_SCOPE);
			for (const other of [
				undefined,
				STATIC_CLIENT_IDS.tuneloCli,
				STATIC_CLIENT_IDS.localmanWeb,
				"some-mcp-client",
			]) {
				expect(scopesOf(resource, other)).not.toContain(MACHINES_WRITE_SCOPE);
			}
		}
		expect(scopesOf(RESOURCES.tunnel, AGENT)).not.toContain(
			MACHINES_WRITE_SCOPE,
		);
		expect(SUPPORTED_SCOPES).toContain(MACHINES_WRITE_SCOPE);
	});
});

describe("tunelo-agent client", () => {
	it("is a public device client for tunnel, Chat MCP and Localman MCP with an explicit scope list", async () => {
		const metadata = await metadataOf(AGENT);
		expect(metadata).toMatchObject({
			application_type: "native",
			token_endpoint_auth_method: "none",
			grant_types: [DEVICE_CODE_GRANT, "refresh_token"],
			allowed_resources: THREE,
		});
		expect(String(metadata.scope).split(" ").sort()).toEqual(
			[
				"openid",
				"offline_access",
				"tunnels:open",
				"tunnels:read",
				"chat:read",
				"chat:write",
				"machines:write",
				"mock:read",
				"mock:write",
				"client:read",
				"client:write",
				"client:send",
			].sort(),
		);
	});

	it("belongs to the device: refresh without the IdP session, no 90-day cap", () => {
		expect(refreshesPerDevice(AGENT)).toBe(true);
		expect(refreshesWithSession(AGENT)).toBe(false);
		expect(hasHardCap(AGENT)).toBe(false);
	});

	it("starts a device login for the three resources", async () => {
		expect(
			await deviceAuthorization(
				AGENT,
				"openid offline_access tunnels:open chat:read machines:write mock:read",
				THREE,
			),
		).toBe("accepted");
	});

	it.each(["bots:admin", "bots:write", "credentials:write"])(
		"refuses %s",
		async (scope) => {
			expect(
				await deviceAuthorization(AGENT, `openid chat:read ${scope}`, THREE),
			).toBe("invalid_scope");
		},
	);

	it("refuses a resource outside its list", async () => {
		expect(
			await deviceAuthorization(AGENT, "openid chat:read", [
				RESOURCES.scribeMcp,
			]),
		).toBe("invalid_target");
		expect(
			await deviceAuthorization(AGENT, "openid mock:read", [
				RESOURCES.localman,
			]),
		).toBe("invalid_target");
	});

	it("refuses machines:write to another device client", async () => {
		expect(
			await deviceAuthorization(
				STATIC_CLIENT_IDS.tuneloCli,
				"openid tunnels:open machines:write",
				[RESOURCES.tunnel],
			),
		).toBe("invalid_scope");
	});

	it("refuses machines:write to a dynamically registered client", async () => {
		await expect(
			client.dynamicClientRegistration(
				new URL(idp.issuer),
				{
					redirect_uris: ["http://127.0.0.1:33418/callback"],
					token_endpoint_auth_method: "none",
					grant_types: ["authorization_code", "refresh_token"],
					scope: `chat:read ${MACHINES_WRITE_SCOPE}`,
				},
				client.None(),
				{ execute: [client.allowInsecureRequests] },
			),
		).rejects.toMatchObject({ error: "invalid_client_metadata" });
	});
});
