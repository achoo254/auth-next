import type { Collection, Db } from "mongodb";
import {
	type Adapter,
	type AdapterFactory,
	type AdapterPayload,
	errors,
} from "oidc-provider";

/**
 * One stored oidc-provider artifact. `grantId`, `userCode` and `uid` are
 * copied out of the payload so they can be indexed without querying inside
 * it: payload keys may contain dots (resource indicators are URLs).
 */
interface StoredArtifact {
	_id: string;
	payload: AdapterPayload;
	expiresAt?: Date;
	grantId?: string;
	userCode?: string;
	uid?: string;
}

/** Every model oidc-provider may persist through the adapter. */
export const OIDC_MODEL_NAMES = [
	"AccessToken",
	"AuthorizationCode",
	"BackchannelAuthenticationRequest",
	"Client",
	"ClientCredentials",
	"DeviceCode",
	"Grant",
	"InitialAccessToken",
	"Interaction",
	"PreAuthorizedCode",
	"PushedAuthorizationRequest",
	"RefreshToken",
	"RegistrationAccessToken",
	"ReplayDetection",
	"Session",
] as const;

/** Models whose artifacts belong to a grant and die with it. */
const GRANTABLE = new Set([
	"AccessToken",
	"AuthorizationCode",
	"RefreshToken",
	"DeviceCode",
	"BackchannelAuthenticationRequest",
	"PreAuthorizedCode",
]);

export function collectionNameFor(model: string): string {
	return `oidc_${model.toLowerCase()}`;
}

function epochSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

/** Matches documents the TTL monitor has not removed yet but that expired. */
function notExpired(): object {
	return {
		$or: [
			{ expiresAt: { $exists: false } },
			{ expiresAt: { $gt: new Date() } },
		],
	};
}

export class MongoAdapter implements Adapter {
	private readonly collection: Collection<StoredArtifact>;

	constructor(
		db: Db,
		private readonly model: string,
	) {
		this.collection = db.collection<StoredArtifact>(collectionNameFor(model));
	}

	async upsert(
		id: string,
		payload: AdapterPayload,
		expiresIn?: number,
	): Promise<void> {
		const document: StoredArtifact = { _id: id, payload };
		if (typeof expiresIn === "number") {
			document.expiresAt = new Date(Date.now() + expiresIn * 1000);
		}
		if (GRANTABLE.has(this.model) && payload.grantId) {
			document.grantId = payload.grantId;
		}
		if (payload.userCode) document.userCode = payload.userCode;
		if (this.model === "Session" && payload.uid) document.uid = payload.uid;
		// replaceOne (not $set) stores payload keys containing dots verbatim.
		await this.collection.replaceOne({ _id: id }, document, { upsert: true });
	}

	async find(id: string): Promise<AdapterPayload | undefined> {
		return this.findOne({ _id: id });
	}

	async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
		return this.findOne({ userCode });
	}

	async findByUid(uid: string): Promise<AdapterPayload | undefined> {
		// Should two documents share a uid, the longest-lived one is current.
		return this.findOne({ uid }, { expiresAt: -1 });
	}

	/**
	 * Marks the artifact consumed only if nobody did so first. oidc-provider
	 * checks `consumed` after reading, so two concurrent exchanges of one code
	 * or refresh token would both pass that check; this conditional update
	 * lets exactly one of them win.
	 */
	async consume(id: string): Promise<void> {
		const result = await this.collection.updateOne(
			{ _id: id, "payload.consumed": { $exists: false } },
			{ $set: { "payload.consumed": epochSeconds() } },
		);
		if (result.matchedCount === 0) {
			throw this.model === "PushedAuthorizationRequest"
				? new errors.InvalidRequestUri(
						"request_uri is invalid, expired, or was already used",
					)
				: new errors.InvalidGrant("grant request is invalid");
		}
	}

	async destroy(id: string): Promise<void> {
		await this.collection.deleteOne({ _id: id });
	}

	async revokeByGrantId(grantId: string): Promise<void> {
		await this.collection.deleteMany({ grantId });
	}

	private async findOne(
		filter: Partial<Pick<StoredArtifact, "_id" | "userCode" | "uid">>,
		sort?: { expiresAt: -1 },
	): Promise<AdapterPayload | undefined> {
		const document = await this.collection.findOne(
			{ ...filter, ...notExpired() },
			{ projection: { payload: 1 }, sort },
		);
		return document?.payload;
	}
}

export function createMongoAdapterFactory(db: Db): AdapterFactory {
	return (model) => new MongoAdapter(db, model);
}

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
			if (GRANTABLE.has(model)) {
				await collection.createIndex({ grantId: 1 }, { sparse: true });
			}
			if (model === "DeviceCode") {
				// Not unique: an expired code may linger until the TTL monitor runs.
				await collection.createIndex({ userCode: 1 }, { sparse: true });
			}
			if (model === "Session") {
				// Not unique: two concurrent logins on one session may each store
				// a regenerated id before the other's destroy runs.
				await collection.createIndex({ uid: 1 }, { sparse: true });
			}
			if (model === "Session" || model === "Grant") {
				// The account page lists a user's sessions and grants.
				await collection.createIndex(
					{ "payload.accountId": 1 },
					{ sparse: true },
				);
			}
		}),
	);
}
