import type { AppServices } from "../services.js";
import type { AuditContext } from "./audit-events.js";

/**
 * A wrong password or recovery code for an existing account, plus a
 * `login.locked` event when that attempt started the account's lock (once
 * per lock, not per refused request).
 */
export async function recordFailedLogin(
	services: AppServices,
	accountId: string,
	method: "password" | "recovery-code",
	accountLocked: boolean,
	context: AuditContext,
): Promise<void> {
	await services.audit.record(
		"login.failed",
		accountId,
		{ method, reason: "invalid" },
		context,
	);
	if (accountLocked) {
		await services.audit.record("login.locked", accountId, { method }, context);
	}
}
