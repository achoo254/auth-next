import { randomBytes } from "node:crypto";
import type { Collection, Db } from "mongodb";
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
	createdAt: Date;
	claimedAt?: Date;
	activatedAt?: Date;
	suspendedAt?: Date;
	suspendedReason?: string;
	/** Last periodic ownership check, and failures in a row since a success. */
	ownershipCheckedAt?: Date;
	ownershipFailures?: number;
}

export const TENANTS_COLLECTION = "tenants";

export function newTenantId(): string {
	return `ten_${randomBytes(12).toString("base64url")}`;
}

/** Statuses that count against TENANT_MAX_ACTIVE and serve pages. */
export const SERVING_STATUSES: readonly TenantStatus[] = ["claimed", "active"];

/**
 * The tenant registry, owned by the IdP: Localman and Tunelo look tenants up
 * through the internal API, never in this database.
 */
export class TenantRegistry {
	private readonly tenants: Collection<TenantDocument>;

	constructor(db: Db) {
		this.tenants = db.collection<TenantDocument>(TENANTS_COLLECTION);
	}

	async findByDomain(domain: string): Promise<TenantDocument | undefined> {
		return (await this.tenants.findOne({ domain })) ?? undefined;
	}

	async findById(id: string): Promise<TenantDocument | undefined> {
		return (await this.tenants.findOne({ _id: id })) ?? undefined;
	}

	/** Tenants holding a slot (claimed or active), primary excluded. */
	countServing(): Promise<number> {
		return this.tenants.countDocuments({
			status: { $in: [...SERVING_STATUSES] },
		});
	}

	/** Tenants whose domain ownership is re-checked periodically. */
	listServing(): Promise<TenantDocument[]> {
		return this.tenants
			.find({ status: { $in: [...SERVING_STATUSES] } })
			.toArray();
	}

	/** Tenants the provisioner should issue (or remove) a certificate for. */
	listCertificateWork(now: Date): Promise<TenantDocument[]> {
		return this.tenants
			.find({
				"certificate.status": { $in: ["pending", "failed", "removing"] },
				$or: [
					{ "certificate.nextAttemptAt": { $exists: false } },
					{ "certificate.nextAttemptAt": { $lte: now } },
				],
			})
			.limit(20)
			.toArray();
	}

	async insert(document: TenantDocument): Promise<void> {
		await this.tenants.insertOne(document);
	}

	async update(
		id: string,
		set: Partial<Omit<TenantDocument, "_id" | "domain">>,
	): Promise<void> {
		await this.tenants.updateOne({ _id: id }, { $set: set });
	}

	/** Replaces the certificate state; undefined removes it (certificates gone). */
	async setCertificate(
		id: string,
		certificate: TenantCertificate | undefined,
	): Promise<void> {
		await this.tenants.updateOne(
			{ _id: id },
			certificate ? { $set: { certificate } } : { $unset: { certificate: "" } },
		);
	}

	/** Records an ownership check; returns the failures in a row after it. */
	async recordOwnershipCheck(id: string, ok: boolean): Promise<number> {
		const after = await this.tenants.findOneAndUpdate(
			{ _id: id },
			ok
				? { $set: { ownershipCheckedAt: new Date(), ownershipFailures: 0 } }
				: {
						$set: { ownershipCheckedAt: new Date() },
						$inc: { ownershipFailures: 1 },
					},
			{ returnDocument: "after" },
		);
		return after?.ownershipFailures ?? 0;
	}
}

export async function ensureTenantRegistryIndexes(db: Db): Promise<void> {
	const tenants = db.collection(TENANTS_COLLECTION);
	await Promise.all([
		tenants.createIndex({ domain: 1 }, { unique: true }),
		tenants.createIndex({ status: 1 }),
		tenants.createIndex({ "certificate.status": 1 }),
	]);
}
