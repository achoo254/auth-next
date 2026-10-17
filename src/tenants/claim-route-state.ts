import type { AccountDocument } from "../accounts/user-model.js";
import { UPSTREAM_PROVIDERS } from "../accounts/user-model.js";
import type { MessageKey } from "../i18n/dictionaries.js";
import { offersHosting } from "./claim-checks.js";
import type { ClaimIdentity } from "./claim-page.js";
import type { ClaimError } from "./claim-service.js";
import type { Tenancy } from "./tenancy.js";
import type { TenantDocument, TenantOwner } from "./tenant-registry.js";
import type { TenantHosting } from "./tenant.js";

/** What /claim reads from an account and shows after each step. */

export const CLAIM_ERRORS: Readonly<Record<ClaimError, MessageKey>> = {
	"invalid-domain": "claim.error.invalidDomain",
	taken: "claim.error.taken",
	"too-many-pending": "claim.error.tooManyPending",
	"too-many-tenants": "claim.error.tooManyTenants",
	capacity: "claim.error.capacity",
	unavailable: "claim.unavailable",
	"not-found": "claim.error.notFound",
	"dns-txt": "claim.error.dnsTxt",
	"dns-address": "claim.error.dnsAddress",
	"dns-unreachable": "claim.error.dnsUnreachable",
};

export const CLAIM_NOTICES: Readonly<Record<string, MessageKey>> = {
	started: "claim.notice.started",
	verified: "claim.notice.verified",
	"verified-self": "claim.notice.verifiedSelf",
	migrating: "claim.notice.migrating",
	"migration-cancelled": "claim.notice.migrationCancelled",
};

/** The identities linked to an account: who could own a claimed domain. */
export function identitiesOf(account: AccountDocument): ClaimIdentity[] {
	return UPSTREAM_PROVIDERS.flatMap((provider) => {
		const providerId = account.providers[provider];
		if (!providerId) return [];
		const detail = account.providerDetails?.[provider];
		return [
			{ provider, providerId, label: detail?.login ?? detail?.email ?? "" },
		];
	});
}

/** Where new tenants can run on this service, this service first. */
export function offeredHostings(tenancy: Tenancy): TenantHosting[] {
	const all: readonly TenantHosting[] = ["hoandat", "self"];
	return all.filter((hosting) => offersHosting(tenancy, hosting));
}

export function isClaimError(value: unknown): value is ClaimError {
	return typeof value === "string" && Object.hasOwn(CLAIM_ERRORS, value);
}

/** The notice after a verified claim: a self-hosted one goes on to its install. */
export function verifiedNotice(tenant: TenantDocument): string {
	return tenant.status === "enrolling"
		? "notice=verified-self"
		: "notice=verified";
}

/**
 * The tenant `tenantId` with its owner, when one of the account's linked
 * identities owns it; undefined otherwise (another person's reads as missing).
 */
export async function ownedTenant(
	tenancy: Tenancy,
	account: AccountDocument,
	tenantId: string,
): Promise<
	{ readonly tenant: TenantDocument; readonly owner: TenantOwner } | undefined
> {
	const tenant = await tenancy.registry.findById(tenantId);
	const owner = tenant?.owner;
	if (!tenant || !owner) return undefined;
	const owns = identitiesOf(account).some(
		(identity) =>
			identity.provider === owner.provider &&
			identity.providerId === owner.providerId,
	);
	return owns ? { tenant, owner } : undefined;
}
