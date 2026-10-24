import { type Db, MongoServerError } from "mongodb";
import { SealedForOthers } from "./sealed-for-others.js";
import type { SecretKeyring } from "./secret-keyring.js";
import {
	type IdpSecretKind,
	type TenantSecretDocument,
	type TenantSecretKind,
	secretContext as contextOf,
} from "./tenant-secret-document.js";

export type {
	IdpSecretKind,
	ScribeSealedKey,
	TenantSecretKind,
} from "./tenant-secret-document.js";

export const TENANT_SECRETS_COLLECTION = "tenant_secrets";

/**
 * Encrypted per-tenant secrets (OAuth apps, bot token, signing keys; the
 * DNS token and AI keys sealed for others). Values are never logged; no
 * API returns one except sealed to its own recipient. Reads decrypt in
 * memory for the tenant's own runtime only.
 */
export class TenantSecrets extends SealedForOthers {
	constructor(
		db: Db,
		private readonly keyring: SecretKeyring,
	) {
		super(db.collection<TenantSecretDocument>(TENANT_SECRETS_COLLECTION));
	}

	async put(
		tenantId: string,
		kind: IdpSecretKind,
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
		kind: IdpSecretKind,
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
		kind: IdpSecretKind,
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
	 * own; DNS tokens and AI keys are sealed for others and marked
	 * `forProvisioner`). Run at startup, so after a new key is put first and
	 * the IdP restarted once, the old key can go. Returns how many were
	 * re-sealed.
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
