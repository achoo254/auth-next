import type { AuditContext } from "../audit/audit-events.js";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import type { AppServices } from "../services.js";
import { type TenantDb, inTenant } from "../tenants/tenant-data.js";
import { forgetDeviceGrants, replacedDeviceGrantIds } from "./device-grants.js";
import { revokeGrant } from "./grant-directory.js";

/** Every grant id of an account (optionally of one client); no page limit. */
export async function grantIdsOf(
	{ db, tenant }: TenantDb,
	accountId: string,
	clientId?: string,
): Promise<string[]> {
	const grants = await db
		.collection<{ _id: string }>(collectionNameFor("Grant"))
		.find(
			{
				"payload.accountId": accountId,
				...inTenant(tenant),
				...(clientId ? { "payload.clientId": clientId } : {}),
			},
			{ projection: { _id: 1 } },
		)
		.toArray();
	return grants.map((grant) => grant._id);
}

/**
 * Every live session of the account except `currentUid`, with no page
 * limit: "sign out every other session" must not miss one.
 */
export async function otherSessionUids(
	tenantDb: TenantDb,
	accountId: string,
	currentUid: string,
): Promise<string[]> {
	const uids = await sessionUidsOf(tenantDb, accountId);
	return uids.filter((uid) => uid !== currentUid);
}

/** Every live session of the account, with no page limit. */
export async function sessionUidsOf(
	{ db, tenant }: TenantDb,
	accountId: string,
): Promise<string[]> {
	const sessions = await db
		.collection(collectionNameFor("Session"))
		.find(
			{
				"payload.accountId": accountId,
				...inTenant(tenant),
				expiresAt: { $gt: new Date() },
			},
			{ projection: { "payload.uid": 1 } },
		)
		.toArray();
	return sessions.flatMap((document) => {
		const payload: unknown = document.payload;
		const uid: unknown =
			typeof payload === "object" && payload !== null
				? Reflect.get(payload, "uid")
				: undefined;
		return typeof uid === "string" ? [uid] : [];
	});
}

/** Revokes grants (refresh tokens, opaque tokens, codes) and their device names. */
export async function revokeGrants(
	services: AppServices,
	accountId: string,
	grantIds: readonly string[],
): Promise<number> {
	let revoked = 0;
	for (const grantId of grantIds) {
		if (await revokeGrant(services.provider, accountId, grantId)) revoked += 1;
	}
	await forgetDeviceGrants(services, grantIds);
	return revoked;
}

/**
 * A machine just approved a new grant: revokes the older grants it held for
 * the same app, so each machine shows once at /account and a token left on
 * its disk from before stops working.
 */
export async function replaceOlderDeviceGrants(
	services: AppServices,
	accountId: string,
	device: {
		readonly clientId: string;
		readonly deviceName: string | undefined;
		readonly grantId: string;
	},
	context: AuditContext,
): Promise<void> {
	const older = await replacedDeviceGrantIds(
		services,
		accountId,
		device.clientId,
		device.deviceName,
		device.grantId,
	);
	if (older.length === 0) return;
	const revoked = await revokeGrants(services, accountId, older);
	if (revoked === 0) return;
	await services.audit.record(
		"grant.revoked",
		accountId,
		{ count: revoked, cause: "replaced", clientId: device.clientId },
		context,
	);
}
