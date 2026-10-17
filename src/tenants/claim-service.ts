import { MongoServerError } from "mongodb";
import { parse } from "tldts";
import { AuditOutbox } from "../audit/audit-outbox.js";
import {
	MAX_TENANTS_PER_ACCOUNT,
	checkClaimDns,
	hasRoomFor,
	offersHosting,
	ownsTooMany,
} from "./claim-checks.js";
import type { AppHostKey } from "./ownership-records.js";
import type { Tenancy } from "./tenancy.js";
import { type ClaimDocument, MAX_PENDING_CLAIMS } from "./tenant-claims.js";
import {
	type TenantDocument,
	type TenantOwner,
	newTenantId,
} from "./tenant-registry.js";
import {
	type TenantHosting,
	looksLikeAppHost,
	normalizeTenantDomain,
} from "./tenant.js";

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

export { MAX_TENANTS_PER_ACCOUNT };

export type ClaimResult<T> =
	| { readonly ok: true; readonly value: T }
	| {
			readonly ok: false;
			readonly error: ClaimError;
			/** With "dns-address": the hosts whose records are not right yet. */
			readonly wrongHosts?: readonly AppHostKey[];
	  };

/** How the audit trail names an owner: the upstream identity, not an account. */
export function ownerSubject(owner: TenantOwner): string {
	return `${owner.provider}:${owner.providerId}`;
}

/**
 * Starts a claim of `input.domain` for `owner` (an identity linked to the
 * signed-in account): the domain must be a plain domain, not blocked, not
 * a tenant already nor above or below one; the account may have only a few
 * claims waiting; the service must be able to take the tenant.
 */
export async function startClaim(
	tenancy: Tenancy,
	input: {
		readonly domain: string;
		readonly owner: TenantOwner;
		readonly accountId: string;
		/** Every identity linked to the account (counts its tenants). */
		readonly identities: readonly TenantOwner[];
		/** Default `hoandat`: the tenant runs on this service (ADR 0006). */
		readonly hosting?: TenantHosting;
	},
): Promise<ClaimResult<ClaimDocument>> {
	const hosting = input.hosting ?? "hoandat";
	if (!offersHosting(tenancy, hosting)) {
		return { ok: false, error: "unavailable" };
	}
	const domain = normalizeTenantDomain(input.domain, tenancy.blockedDomains);
	// auth.x, localman.x, tunnel.x would read as hosts of tenant x (nginx
	// maps hosts to certificates by those labels).
	// Only domains under an ICANN suffix: free dynamic-DNS names (private
	// suffixes) would let one person mint tenants without end.
	if (
		!domain ||
		looksLikeAppHost(domain) ||
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
	if (!(await hasRoomFor(tenancy, hosting))) {
		return { ok: false, error: "capacity" };
	}
	const claim = await tenancy.claims.create({
		domain,
		owner: input.owner,
		accountId: input.accountId,
		hosting,
	});
	return { ok: true, value: claim };
}

/**
 * Checks a claim's DNS: the TXT record with the claim's own value and,
 * unless self-hosted, every app hostname pointing straight at this
 * service. Success creates the tenant owned by the claim's identity:
 * `claimed` with certificates queued, or `enrolling` (no certificate, no
 * runtime) when self-hosted. Every other claim of the domain ends.
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
	const hosting = claim.hosting ?? "hoandat";
	if (!offersHosting(tenancy, hosting)) {
		return { ok: false, error: "unavailable" };
	}
	if (await tenancy.registry.findOverlapping(claim.domain)) {
		return { ok: false, error: "taken" };
	}
	if (!(await hasRoomFor(tenancy, hosting))) {
		return { ok: false, error: "capacity" };
	}
	const proof = await checkClaimDns(tenancy, claim);
	if (proof.result !== "ok") {
		const errors = {
			txt: "dns-txt",
			address: "dns-address",
			unknown: "dns-unreachable",
		} as const;
		return proof.result === "address"
			? { ok: false, error: "dns-address", wrongHosts: proof.wrongHosts }
			: { ok: false, error: errors[proof.result] };
	}
	const now = new Date();
	const tenant: TenantDocument = {
		_id: newTenantId(),
		domain: claim.domain,
		displayName: claim.domain,
		status: hosting === "self" ? "enrolling" : "claimed",
		owner: claim.owner,
		claimTxt: claim.txt,
		...(hosting === "self"
			? {}
			: { certificate: { status: "pending", attempts: 0 } as const }),
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
		{ domain: claim.domain, hosting },
	);
	return { ok: true, value: tenant };
}
