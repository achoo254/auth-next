import type { OAuthAppCredentials } from "../config/integrations-env.js";

/** A tenant's sealed OAuth app (`{ clientId, clientSecret }`), parsed. */
export function parseOAuthApp(
	value: string | undefined,
): OAuthAppCredentials | undefined {
	if (!value) return undefined;
	const parsed: unknown = JSON.parse(value);
	if (typeof parsed !== "object" || parsed === null) return undefined;
	const clientId: unknown = Reflect.get(parsed, "clientId");
	const clientSecret: unknown = Reflect.get(parsed, "clientSecret");
	return typeof clientId === "string" && typeof clientSecret === "string"
		? { clientId, clientSecret }
		: undefined;
}

/** A tenant's sealed Telegram bot (`{ token, username, webhookSecret }`), parsed. */
export function parseTelegramBot(
	value: string | undefined,
): { token: string; username: string; webhookSecret: string } | undefined {
	if (!value) return undefined;
	const parsed: unknown = JSON.parse(value);
	if (typeof parsed !== "object" || parsed === null) return undefined;
	const token: unknown = Reflect.get(parsed, "token");
	const username: unknown = Reflect.get(parsed, "username");
	const webhookSecret: unknown = Reflect.get(parsed, "webhookSecret");
	return typeof token === "string" &&
		typeof username === "string" &&
		typeof webhookSecret === "string"
		? { token, username, webhookSecret }
		: undefined;
}
