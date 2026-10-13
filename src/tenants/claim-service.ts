import { AuditOutbox } from "../audit/audit-outbox.js";
import { checkOwnership } from "./ownership-check.js";
import type { Tenancy } from "./tenancy.js";
import { type ClaimDocument, MAX_PENDING_CLAIMS } from "./tenant-claims.js";
import {
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
	},
): Promise<ClaimResult<ClaimDocument>> {
	if (!tenancy.serviceIp) return { ok: false, error: "unavailable" };
	const domain = normalizeTenantDomain(input.domain, tenancy.blockedDomains);
	// auth.x, localman.x, tunnel.x would read as hosts of tenant x (nginx
	// maps hosts to certificates by those labels).
	if (!domain || APP_LABELS.has(domain.split(".")[0] ?? "")) {
		return { ok: false, error: "invalid-domain" };
	}
	if (await tenancy.registry.findOverlapping(domain)) {
		return { ok: false, error: "taken" };
	}
	if ((await tenancy.claims.countFor(input.accountId)) >= MAX_PENDING_CLAIMS) {
		return { ok: false, error: "too-many-pending" };
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
	accountId: string,
): Promise<ClaimResult<TenantDocument>> {
	const claim = await tenancy.claims.find(claimId, accountId);
	if (!claim) return { ok: false, error: "not-found" };
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
	} catch {
		// Someone verified the same domain a moment earlier.
		return { ok: false, error: "taken" };
	}
	await tenancy.claims.removeDomain(claim.domain);
	await new AuditOutbox(tenancy.db, { id: tenant._id }, tenancy.logger).record(
		"tenant.claimed",
		ownerSubject(claim.owner),
		{ domain: claim.domain },
	);
	return { ok: true, value: tenant };
}
