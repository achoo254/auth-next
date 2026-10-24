import type { Db } from "mongodb";
import {
	SERVING_STATUSES,
	TENANTS_COLLECTION,
	type TenantCertificate,
	type TenantDocument,
	type TenantOwner,
} from "./tenant-document.js";
import { TenantLifecycle } from "./tenant-lifecycle.js";

export {
	type InstallKey,
	SELF_HOSTED_STATUSES,
	SERVING_STATUSES,
	TENANTS_COLLECTION,
	type TenantCertificate,
	type TenantDocument,
	type TenantOwner,
	certificateDue,
	isSelfHosted,
	newTenantId,
} from "./tenant-document.js";

/**
 * The tenant registry, owned by the IdP: Localman and Tunelo look tenants up
 * through the internal API, never in this database.
 */
export class TenantRegistry extends TenantLifecycle {
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

	/**
	 * Tenants the provisioner should issue (or remove) a certificate for:
	 * their hosts certificate, or the `scribe.` one of a tenant served here.
	 */
	listCertificateWork(now: Date): Promise<TenantDocument[]> {
		const work = ["pending", "failed", "removing"];
		return this.tenants
			.find({
				$or: [
					{
						"certificate.status": { $in: work },
						"certificate.nextAttemptAt": { $not: { $gt: now } },
					},
					{
						status: { $in: [...SERVING_STATUSES] },
						"scribeCertificate.status": { $in: work },
						"scribeCertificate.nextAttemptAt": { $not: { $gt: now } },
					},
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

	/**
	 * `active` to `migrating`: the domain stops being served here while its
	 * data is exported to the owner's install (ADR 0007 §7).
	 */
	async startMigration(id: string): Promise<boolean> {
		return this.moveStatus(id, "active", "migrating");
	}

	/** Back to `active`, while the install has not enrolled yet. */
	async cancelMigration(id: string): Promise<boolean> {
		return this.moveStatus(id, "migrating", "active");
	}

	private async moveStatus(
		id: string,
		from: TenantDocument["status"],
		to: TenantDocument["status"],
	): Promise<boolean> {
		const result = await this.tenants.updateOne(
			{ _id: id, status: from },
			{ $set: { status: to }, $inc: { configVersion: 1 } },
		);
		return result.modifiedCount === 1;
	}

	/**
	 * Turns Scribe on (keeping the first `enabledAt`) or off; either change
	 * rebuilds the runtime. True when the tenant changed.
	 */
	async setScribeEnabled(id: string, enabled: boolean): Promise<boolean> {
		const result = await this.tenants.updateOne(
			{ _id: id, scribe: { $exists: !enabled } },
			enabled
				? {
						$set: { scribe: { enabledAt: new Date() } },
						$inc: { configVersion: 1 },
					}
				: { $unset: { scribe: "" }, $inc: { configVersion: 1 } },
		);
		return result.modifiedCount === 1;
	}

	/** Replaces the `scribe.` certificate state; undefined removes it. */
	async setScribeCertificate(
		id: string,
		certificate: TenantCertificate | undefined,
	): Promise<void> {
		await this.tenants.updateOne(
			{ _id: id },
			certificate
				? { $set: { scribeCertificate: certificate } }
				: { $unset: { scribeCertificate: "" } },
		);
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
}

export async function ensureTenantRegistryIndexes(db: Db): Promise<void> {
	const tenants = db.collection(TENANTS_COLLECTION);
	await Promise.all([
		tenants.createIndex({ domain: 1 }, { unique: true }),
		tenants.createIndex({ status: 1 }),
		tenants.createIndex({ "certificate.status": 1 }),
		tenants.createIndex({ "scribeCertificate.status": 1 }),
	]);
}
