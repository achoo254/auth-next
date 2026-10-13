import { randomBytes } from "node:crypto";
import type { Collection, Db } from "mongodb";
import { claimTxtName } from "./ownership-check.js";
import type { TenantOwner } from "./tenant-registry.js";

/** How long a started claim waits for its DNS records. */
export const CLAIM_TTL_MS = 24 * 60 * 60 * 1000;
/** Claims one account may have waiting at once. */
export const MAX_PENDING_CLAIMS = 3;

/**
 * A claim started on the primary tenant, waiting for its TXT record. Kept
 * apart from the registry, so a domain can be claimed by several people at
 * once and nobody can hold a domain they do not control: only verification
 * creates the tenant.
 */
export interface ClaimDocument {
	/** `clm_<random>`. */
	_id: string;
	domain: string;
	/** The identity that becomes owner (Google `sub` or GitHub id). */
	owner: TenantOwner;
	/** The primary tenant's account that started it (lists it on /claim). */
	accountId: string;
	/** Value expected at `_auth-claim.<domain>`: bound to this claim. */
	txt: string;
	createdAt: Date;
	expiresAt: Date;
}

export const TENANT_CLAIMS_COLLECTION = "tenant_claims";

/** The DNS record a claim asks for. */
export function claimRecord(claim: Pick<ClaimDocument, "domain" | "txt">): {
	readonly name: string;
	readonly value: string;
} {
	return { name: claimTxtName(claim.domain), value: claim.txt };
}

export class TenantClaims {
	private readonly claims: Collection<ClaimDocument>;

	constructor(db: Db) {
		this.claims = db.collection<ClaimDocument>(TENANT_CLAIMS_COLLECTION);
	}

	async create(input: {
		readonly domain: string;
		readonly owner: TenantOwner;
		readonly accountId: string;
	}): Promise<ClaimDocument> {
		const now = new Date();
		const claim: ClaimDocument = {
			_id: `clm_${randomBytes(12).toString("base64url")}`,
			...input,
			txt: `hoandat-auth-claim=${randomBytes(24).toString("base64url")}`,
			createdAt: now,
			expiresAt: new Date(now.getTime() + CLAIM_TTL_MS),
		};
		await this.claims.insertOne(claim);
		return claim;
	}

	/** Live claims started by `accountId`, newest first. */
	listFor(accountId: string): Promise<ClaimDocument[]> {
		return this.claims
			.find({ accountId, expiresAt: { $gt: new Date() } })
			.sort({ createdAt: -1 })
			.limit(MAX_PENDING_CLAIMS)
			.toArray();
	}

	countFor(accountId: string): Promise<number> {
		return this.claims.countDocuments({
			accountId,
			expiresAt: { $gt: new Date() },
		});
	}

	/** A live claim of `accountId`; another account's claim reads as missing. */
	async find(
		id: string,
		accountId: string,
	): Promise<ClaimDocument | undefined> {
		return (
			(await this.claims.findOne({
				_id: id,
				accountId,
				expiresAt: { $gt: new Date() },
			})) ?? undefined
		);
	}

	/** Every claim of a domain ends once someone verified it. */
	async removeDomain(domain: string): Promise<void> {
		await this.claims.deleteMany({ domain });
	}
}

export async function ensureTenantClaimIndexes(db: Db): Promise<void> {
	const claims = db.collection(TENANT_CLAIMS_COLLECTION);
	await Promise.all([
		claims.createIndex(
			{ expiresAt: 1 },
			{ expireAfterSeconds: 0, name: "expiresAt_ttl" },
		),
		claims.createIndex({ accountId: 1, createdAt: -1 }),
		claims.createIndex({ domain: 1 }),
	]);
}
