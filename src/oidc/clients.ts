import type { ClientMetadata } from "oidc-provider";
import type { Env } from "../config/env.js";
import {
	ALLOWED_RESOURCES_PROPERTY,
	LOCALMAN_SCOPES,
	RESOURCES,
	TUNNEL_SCOPES,
} from "./resources.js";

export const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export const STATIC_CLIENT_IDS = {
	localmanWeb: "localman-web",
	tuneloCli: "tunelo-cli",
	tuneloWeb: "tunelo-web",
} as const;

const STATIC_ID_SET: ReadonlySet<string> = new Set(
	Object.values(STATIC_CLIENT_IDS),
);

/**
 * First-party confidential apps, trusted to introspect any token (they act
 * for the user across Localman and Tunelo).
 */
export const TRUSTED_INTROSPECTION_CLIENT_IDS: ReadonlySet<string> = new Set([
	STATIC_CLIENT_IDS.localmanWeb,
	STATIC_CLIENT_IDS.tuneloWeb,
]);

/** Static clients are declared here; any other client came through DCR. */
export function isStaticClientId(clientId: unknown): boolean {
	return typeof clientId === "string" && STATIC_ID_SET.has(clientId);
}

function scopeOf(...groups: readonly (readonly string[])[]): string {
	return groups.flat().join(" ");
}

/** Absolute URL of `path` on the app at `base` (ignores any base path). */
function appUrl(base: string, path: string): string {
	return new URL(path, base).href;
}

/**
 * The first-party clients. Secrets and app origins come from the
 * environment so local and staging deployments can point elsewhere.
 */
export function buildStaticClients(env: Env): ClientMetadata[] {
	const localman = env.LOCALMAN_WEB_URL;
	const tunelo = env.TUNELO_WEB_URL;
	return [
		{
			client_id: STATIC_CLIENT_IDS.localmanWeb,
			client_name: "Localman",
			client_secret: env.LOCALMAN_WEB_CLIENT_SECRET,
			token_endpoint_auth_method: "client_secret_basic",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			redirect_uris: [appUrl(localman, "/auth/callback")],
			post_logout_redirect_uris: [appUrl(localman, "/")],
			backchannel_logout_uri: appUrl(localman, "/auth/backchannel-logout"),
			backchannel_logout_session_required: true,
			scope: scopeOf(
				["openid", "profile", "email", "offline_access"],
				LOCALMAN_SCOPES,
			),
			[ALLOWED_RESOURCES_PROPERTY]: [RESOURCES.localman],
		},
		{
			client_id: STATIC_CLIENT_IDS.tuneloCli,
			client_name: "Tunelo CLI",
			application_type: "native",
			token_endpoint_auth_method: "none",
			grant_types: [DEVICE_CODE_GRANT, "refresh_token"],
			response_types: [],
			redirect_uris: [],
			scope: scopeOf(["openid", "offline_access"], TUNNEL_SCOPES),
			[ALLOWED_RESOURCES_PROPERTY]: [RESOURCES.tunnel],
		},
		{
			client_id: STATIC_CLIENT_IDS.tuneloWeb,
			client_name: "Tunelo",
			client_secret: env.TUNELO_WEB_CLIENT_SECRET,
			token_endpoint_auth_method: "client_secret_basic",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			redirect_uris: [appUrl(tunelo, "/auth/callback")],
			post_logout_redirect_uris: [appUrl(tunelo, "/")],
			scope: scopeOf(
				["openid", "profile", "email", "offline_access"],
				TUNNEL_SCOPES,
			),
			[ALLOWED_RESOURCES_PROPERTY]: [RESOURCES.tunnel],
		},
	];
}
