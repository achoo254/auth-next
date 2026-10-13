import type { Collection, Db } from "mongodb";
import {
	type Adapter,
	type AdapterFactory,
	type AdapterPayload,
	errors,
} from "oidc-provider";
import {
	type TenantFilter,
	type TenantScope,
	inTenant,
	tenantTag,
	upsertInTenant,
} from "../tenants/tenant-data.js";

/**
 * One stored oidc-provider artifact. `grantId`, `userCode` and `uid` are
 * copied out of the payload so they can be indexed without querying inside
 * it: payload keys may contain dots (resource indicators are URLs).
 */
interface StoredArtifact {
	_id: string;
	/** The tenant the document belongs to. */
	tenantId: string;
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
export const GRANTABLE_MODELS: ReadonlySet<string> = new Set([
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

/**
 * Stores one model's artifacts for one tenant. Every read, consume and
 * delete is limited to the tenant's documents, so a token, code, session or
 * DCR client of another tenant reads as missing. Static clients are never
 * stored: they come from the provider's `clients` configuration.
 */
export class MongoAdapter implements Adapter {
	private readonly collection: Collection<StoredArtifact>;
	private readonly scope: TenantFilter;

	constructor(
		db: Db,
		private readonly model: string,
		private readonly tenant: TenantScope,
	) {
		this.collection = db.collection<StoredArtifact>(collectionNameFor(model));
		this.scope = inTenant(tenant);
	}

	async upsert(
		id: string,
		payload: AdapterPayload,
		expiresIn?: number,
	): Promise<void> {
		const document: StoredArtifact = {
			_id: id,
			...tenantTag(this.tenant),
			payload,
		};
		if (typeof expiresIn === "number") {
			document.expiresAt = new Date(Date.now() + expiresIn * 1000);
		}
		if (GRANTABLE_MODELS.has(this.model) && payload.grantId) {
			document.grantId = payload.grantId;
		}
		if (payload.userCode) document.userCode = payload.userCode;
		if (this.model === "Session" && payload.uid) document.uid = payload.uid;
		// replaceOne (not $set) stores payload keys containing dots verbatim.
		// Matching the tenant too (untagged pre-tenant documents included for
		// the primary tenant) means an id held by another tenant fails on the
		// unique _id instead of being overwritten.
		const filter = { _id: id, ...this.scope };
		await upsertInTenant(
			() => this.collection.replaceOne(filter, document, { upsert: true }),
			() => this.collection.replaceOne(filter, document),
		);
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
			{ _id: id, ...this.scope, "payload.consumed": { $exists: false } },
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
		await this.collection.deleteOne({ _id: id, ...this.scope });
	}

	async revokeByGrantId(grantId: string): Promise<void> {
		await this.collection.deleteMany({ grantId, ...this.scope });
	}

	private async findOne(
		filter: Partial<Pick<StoredArtifact, "_id" | "userCode" | "uid">>,
		sort?: { expiresAt: -1 },
	): Promise<AdapterPayload | undefined> {
		const document = await this.collection.findOne(
			{ ...filter, ...this.scope, ...notExpired() },
			{ projection: { payload: 1 }, sort },
		);
		return document?.payload;
	}
}

export function createMongoAdapterFactory(
	db: Db,
	tenant: TenantScope,
): AdapterFactory {
	return (model) => new MongoAdapter(db, model, tenant);
}
