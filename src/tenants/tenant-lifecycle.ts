import type { Collection, Db } from "mongodb";
import {
	type InstallKey,
	SELF_HOSTED_STATUSES,
	SERVING_STATUSES,
	TENANTS_COLLECTION,
	type TenantDocument,
} from "./tenant-document.js";

/**
 * Status changes of registry tenants over time: activation, expiry of
 * tenants never activated, ownership checks, suspension and restore. The
 * registry (tenant-registry.ts) adds lookups and settings on top.
 */
export class TenantLifecycle {
	protected readonly tenants: Collection<TenantDocument>;

	constructor(db: Db) {
		this.tenants = db.collection<TenantDocument>(TENANTS_COLLECTION);
	}

	/** Tenants (serving or self-hosted) whose ownership was last checked before `before`. */
	listDueForOwnershipCheck(before: Date): Promise<TenantDocument[]> {
		return this.tenants
			.find({
				// Suspended for ownership too: they come back once DNS is right.
				$and: [
					{
						$or: [
							{
								status: {
									$in: [
										...SERVING_STATUSES,
										...SELF_HOSTED_STATUSES,
										"migrating",
									],
								},
							},
							{ status: "suspended", suspendedReason: "ownership" },
						],
					},
				],
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
		const expired: TenantDocument[] = [];
		for (const tenant of stale) {
			const result = await this.tenants.updateOne(
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
			// Activated meanwhile: not expired.
			if (result.modifiedCount === 1) expired.push(tenant);
		}
		return expired;
	}

	/** `claimed` to `active`, only if still claimed (never revives a suspended one). */
	async activateIfClaimed(id: string): Promise<boolean> {
		const result = await this.tenants.updateOne(
			{ _id: id, status: "claimed" },
			{
				$set: { status: "active", activatedAt: new Date() },
				$inc: { configVersion: 1 },
			},
		);
		return result.modifiedCount === 1;
	}

	/**
	 * Lifts a suspension for ownership once the domain checks out again,
	 * back to the status it had. Returns whether it did.
	 */
	async restoreOwnership(tenant: TenantDocument): Promise<boolean> {
		const result = await this.tenants.updateOne(
			{ _id: tenant._id, status: "suspended", suspendedReason: "ownership" },
			{
				$set: {
					status: tenant.activatedAt ? "active" : "claimed",
					ownershipFailures: 0,
					ownershipCheckedAt: new Date(),
				},
				$unset: { suspendedAt: "", suspendedReason: "" },
				$inc: { configVersion: 1 },
			},
		);
		return result.modifiedCount === 1;
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

	/**
	 * Deletes self-hosted tenants still `enrolling` since before `before`:
	 * their install never enrolled, and nothing of them lives here but the
	 * registry entry. Returns them, which frees their domains.
	 */
	async expireEnrolling(before: Date): Promise<TenantDocument[]> {
		const stale = await this.tenants
			.find({ status: "enrolling", claimedAt: { $lt: before } })
			.limit(50)
			.toArray();
		const expired: TenantDocument[] = [];
		for (const tenant of stale) {
			// Enrolled meanwhile: not expired.
			if (await this.deleteInStatus(tenant._id, ["enrolling"])) {
				expired.push(tenant);
			}
		}
		return expired;
	}

	/**
	 * `enrolling` (or `migrating`) to `self_hosted` with the install's key,
	 * only if still so: of two installs redeeming at once, one wins.
	 */
	async completeEnrollment(
		id: string,
		installKey: InstallKey,
	): Promise<boolean> {
		const result = await this.tenants.updateOne(
			{ _id: id, status: { $in: ["enrolling", "migrating"] } },
			{
				$set: { status: "self_hosted", enrolledAt: new Date(), installKey },
				$inc: { configVersion: 1 },
			},
		);
		return result.modifiedCount === 1;
	}

	/** Deletes a self-hosted tenant's entry (its TXT is gone); frees the domain. */
	removeSelfHosted(id: string): Promise<boolean> {
		return this.deleteInStatus(id, SELF_HOSTED_STATUSES);
	}

	private async deleteInStatus(
		id: string,
		statuses: readonly TenantDocument["status"][],
	): Promise<boolean> {
		const result = await this.tenants.deleteOne({
			_id: id,
			status: { $in: [...statuses] },
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
