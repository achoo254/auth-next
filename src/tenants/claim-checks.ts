import {
	type OwnershipCheck,
	checkClaimTxt,
	checkOwnershipRecords,
} from "./ownership-records.js";
import type { Tenancy } from "./tenancy.js";
import type { ClaimDocument } from "./tenant-claims.js";
import {
	SELF_HOSTED_STATUSES,
	SERVING_STATUSES,
	type TenantOwner,
} from "./tenant-registry.js";
import type { TenantHosting } from "./tenant.js";

/**
 * Tenants per account (claimed, active or self-hosted), so one person
 * cannot fill TENANT_MAX_ACTIVE or hold domains without end.
 */
export const MAX_TENANTS_PER_ACCOUNT = 2;

const HOLDING_STATUSES = [
	...SERVING_STATUSES,
	...SELF_HOSTED_STATUSES,
	"migrating" as const,
];

/** True when the account's identities already own the most tenants allowed. */
export async function ownsTooMany(
	tenancy: Tenancy,
	identities: readonly TenantOwner[],
): Promise<boolean> {
	const owned = await tenancy.registry.listByOwners(identities);
	const holding = owned.filter((tenant) =>
		HOLDING_STATUSES.includes(tenant.status),
	);
	return holding.length >= MAX_TENANTS_PER_ACCOUNT;
}

/**
 * Whether this service takes claims in `hosting` at all: on this service
 * it needs an address to point DNS at (SERVICE_IPV4); self-hosted (ADR
 * 0007) is offered only with SELF_HOSTED_CLAIMS.
 */
export function offersHosting(
	tenancy: Tenancy,
	hosting: TenantHosting,
): boolean {
	return hosting === "self"
		? tenancy.selfHostedClaims
		: tenancy.serviceIp !== undefined;
}

/**
 * Room for one more tenant in `hosting`: under the cap and with enough
 * memory for its runtime. A self-hosted tenant has no runtime here.
 */
export async function hasRoomFor(
	tenancy: Tenancy,
	hosting: TenantHosting,
): Promise<boolean> {
	if (hosting === "self") return true;
	if (tenancy.availableMemoryMb() < tenancy.minAvailableMemoryMb) return false;
	return (await tenancy.registry.countServing()) < tenancy.maxActive;
}

/** The DNS proof a claim needs: the TXT only when self-hosted, else every host too. */
export async function checkClaimDns(
	tenancy: Tenancy,
	claim: ClaimDocument,
): Promise<OwnershipCheck> {
	if (claim.hosting === "self") {
		const result = await checkClaimTxt(
			claim.domain,
			claim.txt,
			tenancy.resolver,
		);
		return { result, wrongHosts: [] };
	}
	if (!tenancy.serviceIp) return { result: "unknown", wrongHosts: [] };
	return checkOwnershipRecords(
		claim.domain,
		claim.txt,
		tenancy.serviceIp,
		tenancy.resolver,
	);
}
