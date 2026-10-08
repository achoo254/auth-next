import type Provider from "oidc-provider";
import type { Logger } from "../logger.js";

/** HTTP status or network error code of a failed back-channel call; never a token. */
function backchannelErrorCode(error: unknown): string {
	if (!(error instanceof Error)) return "error";
	const response: unknown = Reflect.get(error, "response");
	const status =
		typeof response === "object" && response !== null
			? Reflect.get(response, "status")
			: undefined;
	if (typeof status === "number") return `HTTP ${status}`;
	const cause: unknown = error.cause;
	const code = cause instanceof Error ? Reflect.get(cause, "code") : undefined;
	return typeof code === "string" ? code : error.name;
}

/** Operational logs for provider events (no token, cookie or secret). */
export function logProviderEvents(provider: Provider, logger: Logger): void {
	provider.on("server_error", (ctx, error) => {
		logger.error(
			{ err: error, route: ctx.oidc?.route },
			"OIDC provider server error",
		);
	});
	provider.on("grant.revoked", (_ctx, grantId) => {
		logger.info({ grantId }, "Grant revoked");
	});
	// The logout itself still completes; the app just keeps its session.
	provider.on("backchannel.error", (_ctx, error, client) => {
		logger.warn(
			{ clientId: client.clientId, error: backchannelErrorCode(error) },
			"Back-channel logout not delivered",
		);
	});
}
