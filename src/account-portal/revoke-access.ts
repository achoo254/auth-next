import { collectionNameFor } from "../oidc/mongo-adapter.js";
import type { AppServices } from "../services.js";
import { type TenantDb, inTenant } from "../tenants/tenant-data.js";
import { forgetDeviceGrants, revokeGrant } from "./grant-directory.js";

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
