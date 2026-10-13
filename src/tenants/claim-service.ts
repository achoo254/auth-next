import { MongoServerError } from "mongodb";
import { parse } from "tldts";
import { AuditOutbox } from "../audit/audit-outbox.js";
import { checkOwnership } from "./ownership-check.js";
import type { Tenancy } from "./tenancy.js";
import { type ClaimDocument, MAX_PENDING_CLAIMS } from "./tenant-claims.js";
import {
	SERVING_STATUSES,
	type TenantDocument,
	type TenantOwner,
	newTenantId,
} from "./tenant-registry.js";
import { normalizeTenantDomain } from "./tenant.js";

/** Why a claim cannot start or be verified; each has its own message. */
export type ClaimError =
	| "invalid-domain"
	| "taken"
	| "too-many-pending"
	| "too-many-tenants"
	| "capacity"
	| "unavailable"
	| "not-found"
	| "dns-txt"
	| "dns-address"
	| "dns-unreachable";

export type ClaimResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: ClaimError };

const APP_LABELS: ReadonlySet<string> = new Set(["auth", "localman", "tunnel"]);

/** Tenants holding a slot (claimed or active) per account, so one person cannot fill TENANT_MAX_ACTIVE. */
export const MAX_TENANTS_PER_ACCOUNT = 2;

/** True when the account's identities already own the most tenants allowed. */
async function ownsTooMany(
	tenancy: Tenancy,
	identities: readonly TenantOwner[],
): Promise<boolean> {
	const owned = await tenancy.registry.listByOwners(identities);
	const holding = owned.filter((tenant) =>
		SERVING_STATUSES.includes(tenant.status),
	);
	return holding.length >= MAX_TENANTS_PER_ACCOUNT;
}

/** How the audit trail names an owner: the upstream identity, not an account. */
export function ownerSubject(owner: TenantOwner): string {
	return `${owner.provider}:${owner.providerId}`;
}

/** No more tenants while the cap is reached or the machine is short of memory. */
async function hasCapacity(tenancy: Tenancy): Promise<boolean> {
	if (tenancy.availableMemoryMb() < tenancy.minAvailableMemoryMb) return false;
	return (await tenancy.registry.countServing()) < tenancy.maxActive;
}

/**
 * Starts a claim of `input.domain` for `owner` (an identity linked to the
 * signed-in account): the domain must be a plain domain, not blocked, not
 * a tenant already nor above or below one; the account may have only a few
 * claims waiting; the service must have room for another tenant.
 */
export async function startClaim(
	tenancy: Tenancy,
	input: {
		readonly domain: string;
		readonly owner: TenantOwner;
		readonly accountId: string;
		/** Every identity linked to the account (counts its tenants). */
		readonly identities: readonly TenantOwner[];
	},
): Promise<ClaimResult<ClaimDocument>> {
	if (!tenancy.serviceIp) return { ok: false, error: "unavailable" };
	const domain = normalizeTenantDomain(input.domain, tenancy.blockedDomains);
	// auth.x, localman.x, tunnel.x would read as hosts of tenant x (nginx
	// maps hosts to certificates by those labels).
	// Only domains under an ICANN suffix: free dynamic-DNS names (private
	// suffixes) would let one person mint tenants without end.
	if (
		!domain ||
		APP_LABELS.has(domain.split(".")[0] ?? "") ||
		!parse(domain, { allowPrivateDomains: true }).isIcann
	) {
		return { ok: false, error: "invalid-domain" };
	}
	if (await tenancy.registry.findOverlapping(domain)) {
		return { ok: false, error: "taken" };
	}
	if ((await tenancy.claims.countFor(input.accountId)) >= MAX_PENDING_CLAIMS) {
		return { ok: false, error: "too-many-pending" };
	}
	if (await ownsTooMany(tenancy, input.identities)) {
		return { ok: false, error: "too-many-tenants" };
	}
	if (!(await hasCapacity(tenancy))) return { ok: false, error: "capacity" };
	const claim = await tenancy.claims.create({
		domain,
		owner: input.owner,
		accountId: input.accountId,
	});
	return { ok: true, value: claim };
}

/**
 * Checks a claim's DNS: the TXT record with the claim's own value and every
 * app hostname pointing straight at this service. Success creates the
 * tenant, `claimed`, owned by the claim's identity, with certificates
 * queued; every other claim of the domain ends.
 */
export async function verifyClaim(
	tenancy: Tenancy,
	claimId: string,
	account: {
		readonly id: string;
		readonly identities: readonly TenantOwner[];
	},
): Promise<ClaimResult<TenantDocument>> {
	const claim = await tenancy.claims.find(claimId, account.id);
	if (!claim) return { ok: false, error: "not-found" };
	if (await ownsTooMany(tenancy, account.identities)) {
		return { ok: false, error: "too-many-tenants" };
	}
	if (!tenancy.serviceIp) return { ok: false, error: "unavailable" };
	if (await tenancy.registry.findOverlapping(claim.domain)) {
		return { ok: false, error: "taken" };
	}
	if (!(await hasCapacity(tenancy))) return { ok: false, error: "capacity" };
	const proof = await checkOwnership(
		claim.domain,
		claim.txt,
		tenancy.serviceIp,
		tenancy.resolver,
	);
	if (proof !== "ok") {
		const errors = {
			txt: "dns-txt",
			address: "dns-address",
			unknown: "dns-unreachable",
		} as const;
		return { ok: false, error: errors[proof] };
	}
	const now = new Date();
	const tenant: TenantDocument = {
		_id: newTenantId(),
		domain: claim.domain,
		displayName: claim.domain,
		status: "claimed",
		owner: claim.owner,
		claimTxt: claim.txt,
		certificate: { status: "pending", attempts: 0 },
		createdAt: now,
		claimedAt: now,
	};
	try {
		await tenancy.registry.insert(tenant);
	} catch (error) {
		// Someone verified the same domain a moment earlier.
		if (error instanceof MongoServerError && error.code === 11000) {
			return { ok: false, error: "taken" };
		}
		throw error;
	}
	await tenancy.claims.removeDomain(claim.domain);
	await new AuditOutbox(tenancy.db, { id: tenant._id }, tenancy.logger).record(
		"tenant.claimed",
		ownerSubject(claim.owner),
		{ domain: claim.domain },
	);
	return { ok: true, value: tenant };
}
