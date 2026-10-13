import type { Db } from "mongodb";
import {
	GRANTABLE_MODELS,
	OIDC_MODEL_NAMES,
	collectionNameFor,
} from "./mongo-adapter.js";

/**
 * Creates the TTL index (MongoDB deletes a document once `expiresAt` passes)
 * and the lookup indexes. Idempotent; run at startup before serving.
 */
export async function ensureOidcIndexes(db: Db): Promise<void> {
	await Promise.all(
		OIDC_MODEL_NAMES.map(async (model) => {
			const collection = db.collection(collectionNameFor(model));
			await collection.createIndex(
				{ expiresAt: 1 },
				{ expireAfterSeconds: 0, name: "expiresAt_ttl" },
			);
			// Lookups always name the tenant, so it leads every lookup index.
			if (GRANTABLE_MODELS.has(model)) {
				await collection.createIndex({ tenantId: 1, grantId: 1 });
			}
			if (model === "DeviceCode") {
				// Not unique: an expired code may linger until the TTL monitor runs.
				await collection.createIndex({ tenantId: 1, userCode: 1 });
			}
			if (model === "Session") {
				// Not unique: two concurrent logins on one session may each store
				// a regenerated id before the other's destroy runs.
				await collection.createIndex({ tenantId: 1, uid: 1 });
			}
			if (model === "Session" || model === "Grant") {
				// The account page lists a user's sessions and grants.
				await collection.createIndex({ tenantId: 1, "payload.accountId": 1 });
			}
		}),
	);
}
