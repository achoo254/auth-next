import {
	type AccountDocument,
	type UpstreamProvider,
	usableSignInProviders,
} from "../accounts/user-model.js";
import type { AuditContext } from "../audit/audit-events.js";
import { noticeAppName, notifyAccount } from "../push/notify-account.js";
import type { AppServices } from "../services.js";
import { forgetDeviceGrants } from "./device-grants.js";
import { revokeGrant } from "./grant-directory.js";
import { grantIdsOf, revokeGrants } from "./revoke-access.js";
import { revokeUnlinked } from "./revoke-unlinked.js";
import { revokeSession } from "./session-directory.js";

/**
 * What /account and /api/account do, once each: the guard (CSRF and recent
 * sign-in on the web, bearer and re-authentication on the API) stays with
 * the route; the change, its audit event and its notices live here, so
 * both surfaces always do and record the same thing.
 */

/** Where an action came from. */
export interface ActionSource {
	/** IP and User-Agent of the request, for the audit event. */
	readonly context: AuditContext;
	/** The app grant that asked (API): that phone is not notified. */
	readonly grantId?: string;
}

export async function updateProfileName(
	services: AppServices,
	account: AccountDocument,
	name: string | undefined,
): Promise<void> {
	await services.accounts.updateName(account._id, name || undefined);
}

/** Signs browser sessions out (with back-channel logout); the count done. */
export async function signOutSessions(
	services: AppServices,
	account: AccountDocument,
	uids: readonly string[],
	source: ActionSource,
): Promise<number> {
	let count = 0;
	for (const uid of uids) {
		const done = await revokeSession(
			services.provider,
			services,
			services.logger,
			account._id,
			uid,
		);
		if (done) count += 1;
	}
	if (count > 0) {
		await services.audit.record(
			"session.revoked",
			account._id,
			{ count, cause: "account-page" },
			source.context,
		);
		notifyAccount(
			services,
			account,
			{ kind: "access-revoked" },
			{ exceptGrantId: source.grantId },
		);
	}
	return count;
}

/** Revokes one per-device grant (Tunelo CLI, a phone app). */
export async function revokeDevice(
	services: AppServices,
	account: AccountDocument,
	grantId: string,
	source: ActionSource,
): Promise<boolean> {
	const grant = await services.provider.Grant.find(grantId);
	const done = await revokeGrant(services.provider, account._id, grantId);
	if (!done) return false;
	await forgetDeviceGrants(services, [grantId]);
	await services.audit.record(
		"grant.revoked",
		account._id,
		{ count: 1, cause: "account-page" },
		source.context,
	);
	notifyAccount(
		services,
		account,
		{
			kind: "access-revoked",
			appName: grant?.clientId
				? await noticeAppName(services, grant.clientId)
				: undefined,
		},
		{ exceptGrantId: source.grantId },
	);
	return true;
}

/** Removes every grant of one app. `grants` is how many it had. */
export async function revokeApp(
	services: AppServices,
	account: AccountDocument,
	clientId: string,
	source: ActionSource,
): Promise<{ readonly grants: number; readonly revoked: number }> {
	// Every grant of the client, not just those shown on the page.
	const grants = await grantIdsOf(services, account._id, clientId);
	const revoked = await revokeGrants(services, account._id, grants);
	if (revoked > 0) {
		await services.audit.record(
			"grant.revoked",
			account._id,
			{ count: revoked, cause: "account-page", clientId },
			source.context,
		);
		notifyAccount(
			services,
			account,
			{
				kind: "access-revoked",
				appName: await noticeAppName(services, clientId),
			},
			{ exceptGrantId: source.grantId },
		);
	}
	services.logger.info(
		{ accountId: account._id, clientId, grants: grants.length },
		"App access revoked",
	);
	return { grants: grants.length, revoked };
}

/**
 * Unlinks a provider unless it is the last way in: another linked and
 * enabled provider must remain (and the write re-checks one is linked).
 * Apple is told the authorization is over.
 */
export async function unlinkSignInProvider(
	services: AppServices,
	account: AccountDocument,
	provider: UpstreamProvider,
	source: ActionSource,
): Promise<"unlinked" | "last-method"> {
	const others = usableSignInProviders(account, [
		...services.upstreams.keys(),
	]).filter((name) => name !== provider);
	if (others.length === 0) return "last-method";
	const write = await services.accounts.links.unlinkProvider(
		account._id,
		provider,
	);
	if (!write.applied) return "last-method";
	await revokeUnlinked(services, account, provider);
	notifyAccount(
		services,
		account,
		{ kind: "provider-unlinked", provider },
		{ exceptGrantId: source.grantId },
	);
	return "unlinked";
}
