import type Provider from "oidc-provider";
import type { Logger } from "../logger.js";
import type { PushDevices } from "../push/push-devices.js";
import type { ClientUsageRecorder } from "../usage/client-usage-recorder.js";
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
 * Records every authorization an app receives, from this one point.
 * oidc-provider emits `authorization.success` for each authorization it
 * answers: at the authorization endpoint (lib/actions/authorization/
 * respond.js) and in the device flow once the user code is approved
 * (device.js, after `resume`). When the authorization resumes an
 * interaction, `resume` puts the interaction's result on
 * `ctx.oidc.result`; a consent step after a sign-in merges the login
 * result into it. So a login result here means the person signed in on
 * the IdP's pages for this authorization ("interactive"); without one, a
 * live IdP session let them through ("sso"). A sign-in followed by a
 * denied consent never gets here and is not counted.
 */
export function recordClientUsage(
	provider: Provider,
	usage: Pick<ClientUsageRecorder, "record">,
): void {
	provider.on("authorization.success", (ctx) => {
		const accountId = ctx.oidc?.session?.accountId;
		const clientId = ctx.oidc?.client?.clientId;
		if (!accountId || !clientId) return;
		const kind = ctx.oidc.result?.login ? "interactive" : "sso";
		void usage.record(accountId, clientId, kind);
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
