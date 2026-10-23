import type Provider from "oidc-provider";
import type { Logger } from "../logger.js";
import type { PushDevices } from "../push/push-devices.js";
import type { AuditOutbox } from "./audit-outbox.js";

/**
 * Audit events for what oidc-provider does on its own endpoints: a client
 * revoking a token at /token/revocation (which revokes its grant) and an
 * RP-initiated logout. Grants revoked by the logout itself are part of the
 * logout event. Provider events are synchronous, so the write is not
 * awaited; `record` never rejects.
 */
export function auditProviderEvents(
	provider: Provider,
	audit: AuditOutbox,
): void {
	provider.on("grant.revoked", (ctx) => {
		if (ctx.oidc?.route !== "revocation") return;
		const { RefreshToken, AccessToken } = ctx.oidc.entities;
		const token = RefreshToken ?? AccessToken;
		if (!token?.accountId) return;
		void audit.record("grant.revoked", token.accountId, {
			count: 1,
			cause: "token-revocation",
			clientId: token.clientId,
		});
	});
	provider.on("end_session.success", (ctx) => {
		const accountId = ctx.oidc?.session?.accountId;
		if (!accountId) return;
		const everywhere = ctx.oidc.params?.logout !== undefined;
		const clientId = ctx.oidc.entities.Client?.clientId;
		void audit.record("session.logout", accountId, {
			scope: everywhere ? "all" : "client",
			...(clientId ? { clientId } : {}),
		});
	});
}

/**
 * A grant revoked on the provider's own endpoints (/token/revocation, a
 * replayed refresh token) takes the phone's push token with it, so a
 * signed-out app stops hearing about the account at once.
 */
export function forgetRevokedPushDevices(
	provider: Provider,
	devices: Pick<PushDevices, "removeGrants">,
	logger: Logger,
): void {
	provider.on("grant.revoked", (_ctx, grantId: unknown) => {
		if (typeof grantId !== "string") return;
		devices.removeGrants([grantId]).catch((error: unknown) => {
			logger.warn({ err: error }, "Push device of a revoked grant kept");
		});
	});
}
