import type { Collection, Db } from "mongodb";
import {
	SERVING_STATUSES,
	TENANTS_COLLECTION,
	type TenantCertificate,
	type TenantDocument,
	type TenantOwner,
} from "./tenant-document.js";

export {
	SERVING_STATUSES,
	TENANTS_COLLECTION,
	type TenantCertificate,
	type TenantDocument,
	type TenantOwner,
	newTenantId,
} from "./tenant-document.js";

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

	/** A tenant at, above or under `domain`: their hostnames would mix. */
	async findOverlapping(domain: string): Promise<TenantDocument | undefined> {
		const labels = domain.split(".");
		const ancestors = labels.map((_, index) => labels.slice(index).join("."));
		const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return (
			(await this.tenants.findOne({
				$or: [
					{ domain: { $in: ancestors } },
					{ domain: { $regex: `\\.${escaped}$` } },
				],
			})) ?? undefined
		);
	}

	/** Tenants owned by any of these identities (an account's linked ones). */
	listByOwners(owners: readonly TenantOwner[]): Promise<TenantDocument[]> {
		if (owners.length === 0) return Promise.resolve([]);
		return this.tenants
			.find({
				$or: owners.map((owner) => ({
					"owner.provider": owner.provider,
					"owner.providerId": owner.providerId,
				})),
			})
			.sort({ createdAt: -1 })
			.limit(50)
			.toArray();
	}

	/** Tenants holding a slot (claimed or active), primary excluded. */
	countServing(): Promise<number> {
		return this.tenants.countDocuments({
			status: { $in: [...SERVING_STATUSES] },
		});
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

	/** Changes settings or status; the tenant's runtime is rebuilt. */
	async update(
		id: string,
		set: Partial<Omit<TenantDocument, "_id" | "domain" | "configVersion">>,
	): Promise<void> {
		await this.tenants.updateOne(
			{ _id: id },
			{ $set: set, $inc: { configVersion: 1 } },
		);
	}

	/** Marks a change kept elsewhere (a sealed secret): rebuilds the runtime. */
	async touch(id: string): Promise<void> {
		await this.tenants.updateOne({ _id: id }, { $inc: { configVersion: 1 } });
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

	/** Serving tenants whose ownership was last checked before `before`. */
	listDueForOwnershipCheck(before: Date): Promise<TenantDocument[]> {
		return this.tenants
			.find({
				status: { $in: [...SERVING_STATUSES] },
				$or: [
					{ ownershipCheckedAt: { $exists: false } },
					{ ownershipCheckedAt: { $lt: before } },
				],
			})
			.limit(200)
			.toArray();
	}

	/**
	 * Suspends tenants claimed before `before` that never became active
	 * (nobody can have signed in to them) and queues their certificates for
	 * removal; the provisioner's "removed" report then deletes them, which
	 * frees the domain. Returns them.
	 */
	async expireUnactivated(before: Date): Promise<TenantDocument[]> {
		const stale = await this.tenants
			.find({ status: "claimed", claimedAt: { $lt: before } })
			.limit(50)
			.toArray();
		for (const tenant of stale) {
			await this.tenants.updateOne(
				{ _id: tenant._id, status: "claimed" },
				{
					$set: {
						status: "suspended",
						suspendedAt: new Date(),
						suspendedReason: "not-activated",
						certificate: { status: "removing", attempts: 0 },
					},
					$inc: { configVersion: 1 },
				},
			);
		}
		return stale;
	}

	/** Deletes a tenant that never served anyone (expired before activation). */
	async deleteUnactivated(id: string): Promise<boolean> {
		const result = await this.tenants.deleteOne({
			_id: id,
			status: "suspended",
			suspendedReason: "not-activated",
		});
		return result.deletedCount === 1;
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
