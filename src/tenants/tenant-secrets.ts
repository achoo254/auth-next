import { type Collection, type Db, MongoServerError } from "mongodb";
import {
	type ProvisionerSealedValue,
	type SealedValue,
	type SecretKeyring,
	sealForProvisioner,
} from "./secret-keyring.js";

/**
 * What a tenant keeps secret. All but the DNS token are sealed with the
 * IdP's keyring; the DNS token is sealed for the provisioner only.
 */
export type TenantSecretKind =
	| "google"
	| "github"
	| "telegram"
	| "signing-keys"
	| "dns-cloudflare";

interface TenantSecretDocument {
	/** `<tenantId>:<kind>`. */
	_id: string;
	tenantId: string;
	kind: TenantSecretKind;
	sealed: SealedValue | ProvisionerSealedValue;
	/** True for values only the provisioner can open. */
	forProvisioner?: boolean;
	updatedAt: Date;
}

export const TENANT_SECRETS_COLLECTION = "tenant_secrets";

function contextOf(tenantId: string, kind: TenantSecretKind): string {
	return `${tenantId}\n${kind}`;
}

/**
 * Encrypted per-tenant secrets (OAuth apps, bot token, signing keys, DNS
 * token). Values are never logged or returned by any API; reads decrypt
 * in memory for the tenant's own runtime only.
 */
export class TenantSecrets {
	private readonly secrets: Collection<TenantSecretDocument>;

	constructor(
		db: Db,
		private readonly keyring: SecretKeyring,
	) {
		this.secrets = db.collection<TenantSecretDocument>(
			TENANT_SECRETS_COLLECTION,
		);
	}

	async put(
		tenantId: string,
		kind: Exclude<TenantSecretKind, "dns-cloudflare">,
		value: string,
	): Promise<void> {
		const sealed = this.keyring.seal(value, contextOf(tenantId, kind));
		await this.secrets.replaceOne(
			{ _id: `${tenantId}:${kind}` },
			{ tenantId, kind, sealed, updatedAt: new Date() },
			{ upsert: true },
		);
	}

	/**
	 * Stores `value` unless the tenant already has one; returns the stored
	 * value either way, so concurrent first uses agree (signing keys).
	 */
	async putIfAbsent(
		tenantId: string,
		kind: Exclude<TenantSecretKind, "dns-cloudflare">,
		value: string,
	): Promise<string> {
		const sealed = this.keyring.seal(value, contextOf(tenantId, kind));
		try {
			await this.secrets.updateOne(
				{ _id: `${tenantId}:${kind}` },
				{
					$setOnInsert: { tenantId, kind, sealed, updatedAt: new Date() },
				},
				{ upsert: true },
			);
		} catch (error) {
			// A concurrent first use inserted it; its value is the one to use.
			if (!(error instanceof MongoServerError) || error.code !== 11000) {
				throw error;
			}
		}
		const stored = await this.get(tenantId, kind);
		if (stored === undefined) throw new Error("Tenant secret vanished");
		return stored;
	}

	async get(
		tenantId: string,
		kind: Exclude<TenantSecretKind, "dns-cloudflare">,
	): Promise<string | undefined> {
		const document = await this.secrets.findOne({
			_id: `${tenantId}:${kind}`,
			tenantId,
		});
		if (!document || document.forProvisioner) return undefined;
		return this.keyring.open(document.sealed, contextOf(tenantId, kind));
	}

	/**
	 * Re-seals every secret sealed with an older key of the ring (the IdP's
	 * own; DNS tokens are the provisioner's). Run at startup, so after a new
	 * key is put first and the IdP restarted once, the old key can go.
	 * Returns how many were re-sealed.
	 */
	async resealStale(): Promise<number> {
		let resealed = 0;
		const cursor = this.secrets.find({ forProvisioner: { $ne: true } });
		for await (const document of cursor) {
			if (!this.keyring.isStale(document.sealed)) continue;
			const context = contextOf(document.tenantId, document.kind);
			const value = this.keyring.open(document.sealed, context);
			const result = await this.secrets.updateOne(
				{ _id: document._id, "sealed.kid": document.sealed.kid },
				{ $set: { sealed: this.keyring.seal(value, context) } },
			);
			resealed += result.modifiedCount;
		}
		return resealed;
	}

	/** Seals the DNS API token for the provisioner; the IdP cannot read it back. */
	async putForProvisioner(
		tenantId: string,
		value: string,
		provisionerPublicKey: string,
	): Promise<void> {
		const kind = "dns-cloudflare";
		const sealed = sealForProvisioner(
			value,
			contextOf(tenantId, kind),
			provisionerPublicKey,
		);
		await this.secrets.replaceOne(
			{ _id: `${tenantId}:${kind}` },
			{ tenantId, kind, sealed, forProvisioner: true, updatedAt: new Date() },
			{ upsert: true },
		);
	}

	/** The sealed DNS token as stored, for the provisioner to open. */
	async sealedForProvisioner(
		tenantId: string,
	): Promise<ProvisionerSealedValue | undefined> {
		const document = await this.secrets.findOne({
			_id: `${tenantId}:dns-cloudflare`,
			tenantId,
			forProvisioner: true,
		});
		const sealed = document?.sealed;
		return sealed && "wrappedKey" in sealed ? sealed : undefined;
	}

	async has(tenantId: string, kind: TenantSecretKind): Promise<boolean> {
		const count = await this.secrets.countDocuments(
			{ _id: `${tenantId}:${kind}`, tenantId },
			{ limit: 1 },
		);
		return count > 0;
	}

	async remove(tenantId: string, kind: TenantSecretKind): Promise<void> {
		await this.secrets.deleteOne({ _id: `${tenantId}:${kind}`, tenantId });
	}
}
