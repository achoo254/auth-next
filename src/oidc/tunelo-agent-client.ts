import type {
	AccessToken,
	ClientCredentials,
	ClientMetadata,
	JWTStructured,
} from "oidc-provider";
import type { TenantResources } from "../tenants/tenant-resources.js";
import {
	ALLOWED_RESOURCES_PROPERTY,
	LOCALMAN_SCOPES,
	MACHINES_WRITE_SCOPE,
	TUNELO_AGENT_CLIENT_ID,
	TUNNEL_SCOPES,
} from "./resources.js";

/**
 * The Tunelo machine agent (`tunelo`, repo chat-next): one device
 * login gives the machine one refresh token for three resources (tunnel,
 * Chat MCP, Localman MCP); each refresh names the resource it wants a
 * 15-minute token for. Its grant belongs to the device (`refreshesPerDevice`).
 * Removing the machine in Chat revokes that grant
 * (`src/oidc/agent-grant-revocation.ts`).
 */
export const TUNELO_AGENT_CLIENT_IDS = {
	tuneloAgent: TUNELO_AGENT_CLIENT_ID,
} as const;

/**
 * Written out instead of reusing the Chat and Localman MCP lists: the agent
 * never holds `bots:read`, `bots:write`, `bots:admin` or
 * `credentials:write`, and a scope added to those lists later does not
 * reach it.
 */
export const TUNELO_AGENT_SCOPES: readonly string[] = [
	"openid",
	"offline_access",
	...TUNNEL_SCOPES,
	"chat:read",
	"chat:write",
	MACHINES_WRITE_SCOPE,
	...LOCALMAN_SCOPES,
];

export function buildTuneloAgentClients(
	resources: TenantResources,
): ClientMetadata[] {
	return [
		{
			client_id: TUNELO_AGENT_CLIENT_ID,
			// Told apart from Tunelo CLI and the Tunelo website at /account.
			client_name: "Tunelo Agent",
			application_type: "native",
			token_endpoint_auth_method: "none",
			grant_types: [
				"urn:ietf:params:oauth:grant-type:device_code",
				"refresh_token",
			],
			response_types: [],
			redirect_uris: [],
			scope: TUNELO_AGENT_SCOPES.join(" "),
			[ALLOWED_RESOURCES_PROPERTY]: [
				resources.tunnel,
				resources.chatMcp,
				resources.localmanMcp,
			],
		},
	];
}

/**
 * JWT claim naming the grant of an agent's access token. Chat stores it when
 * the machine registers and sends it back to revoke the grant once the
 * owner removes the machine; the id is no credential by itself.
 */
export const AGENT_GRANT_CLAIM = "grant_id";

/** `formats.customizers.jwt`: tags the agent's access tokens with their grant. */
export function addAgentGrantClaim(
	token: AccessToken | ClientCredentials,
	parts: JWTStructured,
): void {
	if (token.clientId !== TUNELO_AGENT_CLIENT_ID || !("grantId" in token)) {
		return;
	}
	if (typeof token.grantId === "string") {
		parts.payload[AGENT_GRANT_CLAIM] = token.grantId;
	}
}
