import type { ClientMetadata } from "oidc-provider";
import { ALLOWED_RESOURCES_PROPERTY } from "./resources.js";

/** Clients of the chat app (repo chat-next): web, mobile, desktop. */
export const CHAT_CLIENT_IDS = {
	chatWeb: "chat-web",
	chatMobile: "chat-mobile",
	chatDesktop: "chat-desktop",
} as const;

/**
 * Default private-use URI scheme redirect of the chat mobile app (RFC 8252
 * §7.1); `CHAT_MOBILE_REDIRECT_URI` overrides it. The scheme is fixed when
 * the app is built (its brand configuration), so it is the same in every
 * tenant, and renaming the app only changes configuration on both sides.
 */
export const CHAT_MOBILE_REDIRECT_URI = "com.hoandat.chat:/auth/callback";

/** `<reverse-domain scheme>:/<path>`, the RFC 8252 §7.1 form with one slash. */
export const PRIVATE_USE_REDIRECT =
	/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*){2,}:\/[a-z0-9_-]+(\/[a-z0-9_-]+)*$/;

/**
 * Loopback redirect of the chat desktop app (RFC 8252 §7.3): oidc-provider
 * ignores the port of a loopback redirect for native clients, so the app
 * listens on whichever port is free.
 */
export const CHAT_DESKTOP_REDIRECT_URI = "http://127.0.0.1/auth/callback";

/**
 * Chat runs its own sessions and only reads the ID token and userinfo, so
 * no client asks for an API scope or resource.
 */
const CHAT_SCOPE = "openid profile email";

/** A public native chat client: Code + PKCE through the system browser. */
function nativeChatClient(
	clientId: string,
	redirectUri: string,
): ClientMetadata {
	return {
		client_id: clientId,
		client_name: "Chat",
		application_type: "native",
		token_endpoint_auth_method: "none",
		grant_types: ["authorization_code", "refresh_token"],
		response_types: ["code"],
		redirect_uris: [redirectUri],
		scope: CHAT_SCOPE,
		[ALLOWED_RESOURCES_PROPERTY]: [],
	};
}

/** The chat clients of a tenant whose chat web app lives at `chatOrigin`. */
export function buildChatClients(
	chatOrigin: string,
	webSecret: string,
	mobileRedirectUri: string,
): ClientMetadata[] {
	const at = (path: string): string => new URL(path, chatOrigin).href;
	return [
		{
			client_id: CHAT_CLIENT_IDS.chatWeb,
			client_name: "Chat",
			client_secret: webSecret,
			token_endpoint_auth_method: "client_secret_basic",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			redirect_uris: [at("/auth/callback")],
			post_logout_redirect_uris: [at("/")],
			backchannel_logout_uri: at("/auth/backchannel-logout"),
			backchannel_logout_session_required: true,
			// No offline_access: its refresh tokens live with the IdP session.
			scope: CHAT_SCOPE,
			[ALLOWED_RESOURCES_PROPERTY]: [],
		},
		nativeChatClient(CHAT_CLIENT_IDS.chatMobile, mobileRedirectUri),
		nativeChatClient(CHAT_CLIENT_IDS.chatDesktop, CHAT_DESKTOP_REDIRECT_URI),
	];
}
