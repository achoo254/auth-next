import type Provider from "oidc-provider";
import { STATIC_CLIENT_IDS, refreshesPerDevice } from "../oidc/clients.js";
import { type TenantDb, inTenant, tenantTag } from "../tenants/tenant-data.js";
import type { GrantSummary } from "./grant-directory.js";

/**
 * Clients whose every approval is a new grant for one machine, listed and
 * revoked one by one at /account: Tunelo CLI and the native apps whose
 * refresh belongs to the device (`refreshesPerDevice`).
 */
export function grantsPerDevice(clientId: string | undefined): boolean {
	return (
		clientId === STATIC_CLIENT_IDS.tuneloCli || refreshesPerDevice(clientId)
	);
}

export const GRANT_META_COLLECTION = "grant_meta";

interface DeviceMetaDocument {
	_id: string;
	/** The tenant the document belongs to. */
	tenantId: string;
	accountId: string;
	/** Missing when the app sent neither a machine name nor a User-Agent. */
	deviceName?: string;
	ip?: string;
	userAgent?: string;
	createdAt: Date;
	expiresAt: Date;
}

export interface DeviceGrant extends GrantSummary {
	/** The client's display name (Tunelo CLI, Chat...). */
	readonly appName: string;
	readonly deviceName?: string;
}

/**
 * Remembers which machine a per-device grant (Tunelo CLI, native apps)
 * belongs to.
 */
export async function recordDeviceGrant(
	{ db, tenant }: TenantDb,
	meta: Omit<DeviceMetaDocument, "createdAt" | "expiresAt" | "tenantId">,
	ttlSeconds: number,
): Promise<void> {
	const now = new Date();
	await db.collection<DeviceMetaDocument>(GRANT_META_COLLECTION).replaceOne(
		{ _id: meta._id, ...inTenant(tenant) },
		{
			...meta,
			...tenantTag(tenant),
			createdAt: now,
			expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
		},
		{ upsert: true },
	);
}

/**
 * Per-device grants, one row per machine, with the device name captured at
 * approval.
 */
export async function listDeviceGrants(
	{ db, tenant }: TenantDb,
	provider: Provider,
	grants: readonly GrantSummary[],
): Promise<DeviceGrant[]> {
	const devices = grants.filter((grant) => grantsPerDevice(grant.clientId));
	const ids = devices.map((grant) => grant.grantId);
	const metas = await db
		.collection<DeviceMetaDocument>(GRANT_META_COLLECTION)
		.find({ _id: { $in: ids }, ...inTenant(tenant) })
		.toArray();
	const names = new Map(metas.map((meta) => [meta._id, meta.deviceName]));
	const clientIds = [...new Set(devices.map((grant) => grant.clientId))];
	const appNames = new Map(
		await Promise.all(
			clientIds.map(async (clientId) => {
				const client = await provider.Client.find(clientId);
				return [clientId, client?.clientName ?? clientId] as const;
			}),
		),
	);
	return devices.map((grant) => ({
		...grant,
		appName: appNames.get(grant.clientId) ?? grant.clientId,
		deviceName: names.get(grant.grantId) ?? undefined,
	}));
}

/** Drops the device names of revoked grants. */
export async function forgetDeviceGrants(
	{ db, tenant }: TenantDb,
	grantIds: readonly string[],
): Promise<void> {
	const metas = db.collection<DeviceMetaDocument>(GRANT_META_COLLECTION);
	await metas.deleteMany({ _id: { $in: [...grantIds] }, ...inTenant(tenant) });
}
