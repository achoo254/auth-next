import type { Collection, Db } from "mongodb";
import type { Locale } from "../i18n/locales.js";
import {
	type TenantDb,
	type TenantFilter,
	type TenantScope,
	inTenant,
	tenantTag,
} from "../tenants/tenant-data.js";

export const PUSH_DEVICES_COLLECTION = "push_devices";

/** Which APNs host serves the token: the app's build decides (entitlement). */
export const APNS_ENVIRONMENTS = ["sandbox", "production"] as const;
export type ApnsEnvironment = (typeof APNS_ENVIRONMENTS)[number];

/**
 * One phone that receives security notices for an account. It belongs to
 * the grant of the app's sign-in on that phone: it lives (TTL) and slides
 * with that grant, and goes when the grant is revoked.
 */
export interface PushDeviceDocument {
	/** The tenant the document belongs to. */
	tenantId: string;
	accountId: string;
	grantId: string;
	/** The APNs device token (hex). Never logged in full. */
	token: string;
	environment: ApnsEnvironment;
	/** Language of the notices. */
	locale: Locale;
	updatedAt: Date;
	expiresAt: Date;
}

export type PushDevice = Omit<PushDeviceDocument, "tenantId">;

/** The last characters of a device token: enough to tell two apart in logs. */
export function tokenHint(token: string): string {
	return `…${token.slice(-6)}`;
}

/** Device tokens of one tenant; the only module that touches push_devices. */
export class PushDevices {
	private readonly devices: Collection<PushDeviceDocument>;
	private readonly scope: TenantFilter;

	constructor(
		db: Db,
		private readonly tenant: TenantScope,
	) {
		this.devices = db.collection<PushDeviceDocument>(PUSH_DEVICES_COLLECTION);
		this.scope = inTenant(tenant);
	}

	/**
	 * Registers (or registers again) the token for `grantId`. A token is one
	 * phone: registering it under another grant or account moves it there.
	 * A grant has one token: an older token of the same grant is dropped.
	 */
	async register(device: Omit<PushDevice, "updatedAt">): Promise<void> {
		const now = new Date();
		await this.devices.replaceOne(
			{ token: device.token, ...this.scope },
			{ ...device, ...tenantTag(this.tenant), updatedAt: now },
			{ upsert: true },
		);
		await this.devices.deleteMany({
			grantId: device.grantId,
			token: { $ne: device.token },
			...this.scope,
		});
	}

	/** The account's devices, except those of `exceptGrantId`. */
	async listFor(
		accountId: string,
		exceptGrantId?: string,
	): Promise<PushDevice[]> {
		const documents = await this.devices
			.find({
				accountId,
				...this.scope,
				expiresAt: { $gt: new Date() },
				...(exceptGrantId ? { grantId: { $ne: exceptGrantId } } : {}),
			})
			.limit(50)
			.toArray();
		return documents.map(({ tenantId: _tenantId, ...device }) => device);
	}

	/** Forgets every device of these grants (revoked, signed out). */
	async removeGrants(grantIds: readonly string[]): Promise<number> {
		if (grantIds.length === 0) return 0;
		const result = await this.devices.deleteMany({
			grantId: { $in: [...grantIds] },
			...this.scope,
		});
		return result.deletedCount;
	}

	/**
	 * Forgets a token APNs refused. With `unregisteredAt` (APNs 410), only
	 * if the phone has not registered it again since then.
	 */
	async removeToken(token: string, unregisteredAt?: Date): Promise<void> {
		await this.devices.deleteOne({
			token,
			...this.scope,
			...(unregisteredAt ? { updatedAt: { $lt: unregisteredAt } } : {}),
		});
	}
}

/** Unique token per tenant, lookups by account and by grant, TTL. */
export async function ensurePushDeviceIndexes(db: Db): Promise<void> {
	const devices = db.collection(PUSH_DEVICES_COLLECTION);
	await Promise.all([
		devices.createIndex(
			{ tenantId: 1, token: 1 },
			{ unique: true, name: "tenant_token" },
		),
		devices.createIndex(
			{ tenantId: 1, accountId: 1 },
			{ name: "tenant_account" },
		),
		devices.createIndex({ tenantId: 1, grantId: 1 }, { name: "tenant_grant" }),
		devices.createIndex(
			{ expiresAt: 1 },
			{ expireAfterSeconds: 0, name: "expiresAt_ttl" },
		),
	]);
}

/** Moves the devices of a grant to the grant's new expiry (refresh). */
export async function slidePushDevices(
	{ db, tenant }: TenantDb,
	grantId: string,
	expiresAt: Date,
): Promise<void> {
	await db
		.collection<PushDeviceDocument>(PUSH_DEVICES_COLLECTION)
		.updateMany({ grantId, ...inTenant(tenant) }, { $set: { expiresAt } });
}
