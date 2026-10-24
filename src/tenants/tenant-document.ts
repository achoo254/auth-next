import { randomBytes } from "node:crypto";
import type { UpstreamProvider } from "../accounts/user-model.js";
import type { TenantStatus } from "./tenant.js";

/** Who claimed a domain: the upstream identity that proved the TXT record. */
export interface TenantOwner {
	readonly provider: UpstreamProvider;
	readonly providerId: string;
	readonly email?: string;
}

/** Certificate state, driven by the provisioner through the internal API. */
export interface TenantCertificate {
	readonly status: "pending" | "issued" | "failed" | "removing";
	readonly attempts: number;
	readonly lastAttemptAt?: Date;
	/** Short reason of the last failure; never a log or a secret. */
	readonly lastError?: string;
	readonly nextAttemptAt?: Date;
	readonly issuedAt?: Date;
}

/**
 * The public ES256 key a self-hosted install enrolled with (ADR 0007):
 * public parts only. Phase 05 seals secrets moved to the install to it.
 */
export interface InstallKey {
	readonly jwk: {
		readonly kty: "EC";
		readonly crv: "P-256";
		readonly x: string;
		readonly y: string;
	};
	/** RFC 7638 thumbprint: the same install redeeming again is recognised. */
	readonly thumbprint: string;
}

/** One claimed domain in the `tenants` collection (the registry). */
export interface TenantDocument {
	/** `ten_<random>`: never reused, so a domain claimed again starts empty. */
	_id: string;
	/** Normalised domain (normalizeTenantDomain); unique. */
	domain: string;
	displayName: string;
	status: TenantStatus;
	owner?: TenantOwner;
	/** The TXT value at `_auth-claim.<domain>` that proved ownership. */
	claimTxt?: string;
	certificate?: TenantCertificate;
	/**
	 * Scribe runs here since the owner saved its first transcription key
	 * (ADR 0012); removed with the last one.
	 */
	scribe?: { readonly enabledAt: Date };
	/**
	 * The `scribe.<domain>` certificate: its own lineage, never part of
	 * `certificate`, so a missing `scribe.` record breaks nothing else.
	 */
	scribeCertificate?: TenantCertificate;
	createdAt: Date;
	claimedAt?: Date;
	activatedAt?: Date;
	/** Self-hosted: when its install enrolled, and with which key. */
	enrolledAt?: Date;
	installKey?: InstallKey;
	suspendedAt?: Date;
	suspendedReason?: string;
	/**
	 * Bumped by every change of settings or status; a runtime built for an
	 * older version is rebuilt on the next request. Absent means 0.
	 */
	configVersion?: number;
	/** Last periodic ownership check, and failures in a row since a success. */
	ownershipCheckedAt?: Date;
	ownershipFailures?: number;
}

export const TENANTS_COLLECTION = "tenants";

export function newTenantId(): string {
	return `ten_${randomBytes(12).toString("base64url")}`;
}

/** True when the provisioner should work on `certificate` now. */
export function certificateDue(
	certificate: TenantCertificate | undefined,
	now: Date,
): boolean {
	if (!certificate || certificate.status === "issued") return false;
	// Not a date (absent, or null after a manual edit): due now.
	const next: unknown = certificate.nextAttemptAt;
	return !(next instanceof Date) || next.getTime() <= now.getTime();
}

/** Statuses that count against TENANT_MAX_ACTIVE and serve pages. */
export const SERVING_STATUSES: readonly TenantStatus[] = ["claimed", "active"];

/**
 * Statuses of a self-hosted tenant (ADR 0007): no runtime, certificate or
 * nginx block here, and only its TXT record is ever checked.
 */
export const SELF_HOSTED_STATUSES: readonly TenantStatus[] = [
	"enrolling",
	"self_hosted",
];

export function isSelfHosted(tenant: Pick<TenantDocument, "status">): boolean {
	return SELF_HOSTED_STATUSES.includes(tenant.status);
}
