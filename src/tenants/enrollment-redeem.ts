import { randomBytes } from "node:crypto";
import { calculateJwkThumbprint } from "jose";
import { AuditOutbox } from "../audit/audit-outbox.js";
import { ownerSubject } from "./claim-service.js";
import {
	localBundleKeys,
	verifyEnrollmentBundle,
} from "./enrollment-bundle.js";
import { verifyChallenge } from "./enrollment-challenge.js";
import { checkClaimTxt } from "./ownership-records.js";
import type { Tenancy } from "./tenancy.js";
import type { InstallKey } from "./tenant-registry.js";

/** Why a redemption failed; each maps to its own HTTP answer. */
export type RedeemError =
	| "invalid-bundle"
	| "invalid-key"
	| "not-enrolling"
	| "dns-txt"
	| "dns-unreachable"
	| "challenge";

export type RedeemResult =
	| { readonly ok: true; readonly tenantId: string }
	| { readonly ok: false; readonly error: RedeemError };

/** A P-256 coordinate in base64url: 32 bytes, 43 characters. */
const COORDINATE = /^[A-Za-z0-9_-]{43}$/;

/**
 * The install's public key as sent: an EC P-256 JWK with public parts
 * only. Anything else (a private key, another curve, extra members that
 * would change its meaning) is refused rather than trimmed.
 */
export function parseInstallKey(value: unknown): InstallKey["jwk"] | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const allowed = new Set(["kty", "crv", "x", "y", "alg", "use", "kid"]);
	if (Object.keys(value).some((key) => !allowed.has(key))) return undefined;
	const { kty, crv, x, y } = value as Record<string, unknown>;
	if (kty !== "EC" || crv !== "P-256") return undefined;
	if (typeof x !== "string" || typeof y !== "string") return undefined;
	if (!COORDINATE.test(x) || !COORDINATE.test(y)) return undefined;
	return { kty, crv, x, y };
}

/**
 * Redeems an enrollment bundle at the gateway (ADR 0007). The bundle must
 * be ours and current; its tenant `enrolling` (or already self-hosted by
 * this very key: a retry succeeds again); its TXT still proven; and the
 * install serving `https://auth.<d>` must sign a fresh nonce with the key
 * it presents. Then the tenant is `self_hosted` and this service leaves
 * every request path of the domain.
 */
export async function redeemEnrollment(
	tenancy: Tenancy,
	input: { readonly bundle: unknown; readonly installKey: unknown },
): Promise<RedeemResult> {
	const claims =
		typeof input.bundle === "string"
			? await verifyEnrollmentBundle(
					input.bundle,
					localBundleKeys(tenancy.signingJwks),
					{ issuer: tenancy.issuer },
				)
			: undefined;
	if (!claims) return { ok: false, error: "invalid-bundle" };
	const jwk = parseInstallKey(input.installKey);
	if (!jwk) return { ok: false, error: "invalid-key" };
	const thumbprint = await calculateJwkThumbprint(jwk);
	const tenant = await tenancy.registry.findById(claims.tenantId);
	if (!tenant || tenant.domain !== claims.domain || !tenant.claimTxt) {
		return { ok: false, error: "not-enrolling" };
	}
	if (tenant.status === "self_hosted") {
		return tenant.installKey?.thumbprint === thumbprint
			? { ok: true, tenantId: tenant._id }
			: { ok: false, error: "not-enrolling" };
	}
	if (tenant.status !== "enrolling" && tenant.status !== "migrating")
		return { ok: false, error: "not-enrolling" };
	const txt = await checkClaimTxt(
		tenant.domain,
		tenant.claimTxt,
		tenancy.resolver,
	);
	if (txt !== "ok") {
		return { ok: false, error: txt === "txt" ? "dns-txt" : "dns-unreachable" };
	}
	const nonce = randomBytes(24).toString("base64url");
	const answer = await tenancy.fetchChallenge(tenant.domain, nonce);
	if (!answer || !(await verifyChallenge(answer, jwk, nonce, tenancy.issuer))) {
		return { ok: false, error: "challenge" };
	}
	if (
		!(await tenancy.registry.completeEnrollment(tenant._id, {
			jwk,
			thumbprint,
		}))
	) {
		// Another install won the race, or the entry expired meanwhile.
		return { ok: false, error: "not-enrolling" };
	}
	if (tenant.owner) {
		await new AuditOutbox(
			tenancy.db,
			{ id: tenant._id },
			tenancy.logger,
		).record("tenant.self_hosted", ownerSubject(tenant.owner), {
			domain: tenant.domain,
		});
	}
	return { ok: true, tenantId: tenant._id };
}
