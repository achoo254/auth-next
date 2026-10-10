import type { Db } from "mongodb";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import type { AppServices } from "../services.js";
import { GRANT_META_COLLECTION, revokeGrant } from "./grant-directory.js";

/** Every grant id of an account (optionally of one client); no page limit. */
export async function grantIdsOf(
	db: Db,
	accountId: string,
	clientId?: string,
): Promise<string[]> {
	const grants = await db
		.collection<{ _id: string }>(collectionNameFor("Grant"))
		.find(
			{
				"payload.accountId": accountId,
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
	await services.db
		.collection<{ _id: string }>(GRANT_META_COLLECTION)
		.deleteMany({ _id: { $in: [...grantIds] } });
	return revoked;
}
