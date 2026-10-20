import type { AccountRepository } from "../accounts/account-repository.js";
import { UPSTREAM_PROVIDERS } from "../accounts/user-model.js";
import type { AppServices } from "../services.js";
import { PRIMARY_TENANT_ID } from "../tenants/env-tenant.js";
import type { TenantClaims } from "../tenants/tenant-claims.js";
import type { TenantDb, TenantScope } from "../tenants/tenant-data.js";
import { type PurgeCount, purgeAccountData } from "./account-data-purge.js";
import { grantIdsOf, revokeGrants, sessionUidsOf } from "./revoke-access.js";
import { revokeUnlinked } from "./revoke-unlinked.js";
import { revokeSession } from "./session-directory.js";

/**
 * People delete their own account on an install's primary tenant, here or
 * self-hosted (ADR 0009); a registry tenant's privacy page names a contact.
 */
export function deletesOwnAccount(tenant: TenantScope): boolean {
	return tenant.id === PRIMARY_TENANT_ID;
}

/** Where the person asked for the deletion. */
export type AccountDeletionSource = "web" | "app";

export interface FinishDeletionDeps extends TenantDb {
	readonly accounts: AccountRepository;
	/** Domain claims, when registry tenants are enabled. */
	readonly claims?: TenantClaims;
}

/**
 * The part of a deletion that needs only the database: the account's
 * documents, its domain claims, then the account. Safe to run again on a
 * disabled account whose deletion stopped half way.
 */
export async function finishAccountDeletion(
	deps: FinishDeletionDeps,
	accountId: string,
): Promise<PurgeCount[]> {
	const account = await deps.accounts.findIncludingDisabled(accountId);
	if (account && !account.disabledAt) {
		throw new Error("Account still in use: disable it first");
	}
	const counts = await purgeAccountData(deps, accountId);
	const claims = (await deps.claims?.removeFor(accountId)) ?? 0;
	const accounts = (await deps.accounts.deleteDisabled(accountId)) ? 1 : 0;
	// Once more: a sign-in decided before the account was disabled may have
	// written a session or an event meanwhile.
	const late = await purgeAccountData(deps, accountId);
	return [
		...counts.map((entry, index) => ({
			collection: entry.collection,
			count: entry.count + (late[index]?.count ?? 0),
		})),
		{ collection: "tenant_claims", count: claims },
		{ collection: "accounts", count: accounts },
	];
}

/**
 * Deletes an account for good (ADR 0009). The order matters: disable first,
 * so nothing new can be signed in, linked or refreshed while the rest runs;
 * then end the provider links and every session the way a sign-out does
 * (back-channel logout to the apps); then remove the data and the account;
 * the audit event last, once it is all gone.
 */
export async function deleteAccount(
	services: AppServices,
	accountId: string,
	source: AccountDeletionSource,
): Promise<"deleted" | "not-found"> {
	const { accounts } = services;
	// Only the request that disabled the account goes on: a second click
	// finds it disabled already. A stopped deletion is finished by the
	// finish-account-deletion script.
	if ((await accounts.disable(accountId)) !== "disabled") return "not-found";
	try {
		await revokeAndErase(services, accountId);
	} catch (error) {
		services.logger.error(
			{ err: error, accountId },
			"Account deletion stopped: finish it with finish-account-deletion",
		);
		throw error;
	}
	await services.audit.record("account.deleted", accountId, { source });
	services.logger.info({ accountId, source }, "Account deleted");
	return "deleted";
}

/** Everything after the account is disabled, up to removing it. */
async function revokeAndErase(
	services: AppServices,
	accountId: string,
): Promise<void> {
	// Read after disabling: a link that raced the fence is included.
	const account = await services.accounts.findIncludingDisabled(accountId);
	if (!account) return;
	for (const provider of UPSTREAM_PROVIDERS) {
		await revokeUnlinked(services, account, provider);
	}
	for (const uid of await sessionUidsOf(services, accountId)) {
		await revokeSession(
			services.provider,
			services,
			services.logger,
			accountId,
			uid,
		);
	}
	await revokeGrants(
		services,
		accountId,
		await grantIdsOf(services, accountId),
	);
	await finishAccountDeletion(
		{ ...services, claims: services.tenancy?.claims },
		accountId,
	);
}
