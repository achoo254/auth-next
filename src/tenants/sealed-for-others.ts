import type { Collection } from "mongodb";
import {
	SCRIBE_VENDORS,
	type ScribeKeyKind,
	type ScribeKeyStatus,
	type ScribeVendor,
	scribeKeyKind,
} from "./scribe-vendors.js";
import {
	type ProvisionerSealedValue,
	type RecipientSealedValue,
	type SealedValue,
	sealForProvisioner,
	sealForRecipient,
} from "./secret-keyring.js";

/**
 * What a tenant keeps secret. The IdP's own kinds are sealed with its
 * keyring; the DNS token is sealed for the provisioner and AI keys for
 * Scribe, so the IdP cannot read those back.
 */
export type TenantSecretKind =
	| "google"
	| "github"
	| "telegram"
	| "signing-keys"
	| "dns-cloudflare"
	| ScribeKeyKind;

/** Kinds the IdP itself seals and opens. */
export type IdpSecretKind = Exclude<
	TenantSecretKind,
	"dns-cloudflare" | ScribeKeyKind
>;

export interface TenantSecretDocument {
	/** `<tenantId>:<kind>`. */
	_id: string;
	tenantId: string;
	kind: TenantSecretKind;
	sealed: SealedValue | ProvisionerSealedValue | RecipientSealedValue;
	/**
	 * True for values the IdP cannot open (sealed for the provisioner or for
	 * Scribe). Every version of `get` and `resealStale` skips them.
	 */
	forProvisioner?: boolean;
	/** Set on AI keys: the service they are sealed for. */
	sealedFor?: "scribe";
	/** Last 4 characters of an AI key, so the owner recognises it. */
	hint?: string;
	/** What Scribe last reported about an AI key, and when. */
	status?: ScribeKeyStatus;
	statusAt?: Date;
	updatedAt: Date;
}

/** One AI key as Scribe receives it: sealed, never the plaintext. */
export interface ScribeSealedKey {
	readonly vendor: ScribeVendor;
	readonly hint: string;
	readonly updatedAt: Date;
	readonly status?: ScribeKeyStatus;
	readonly statusAt?: Date;
	readonly sealed: RecipientSealedValue;
}

/** Additional data binding a sealed value to its tenant and kind. */
export function secretContext(
	tenantId: string,
	kind: TenantSecretKind,
): string {
	return `${tenantId}\n${kind}`;
}

function isRecipientSealed(
	sealed: TenantSecretDocument["sealed"],
): sealed is RecipientSealedValue {
	return "recipient" in sealed && "wrappedKey" in sealed;
}

/**
 * Tenant secrets the IdP keeps for another service and cannot open: the
 * DNS token (provisioner) and AI keys (Scribe, ADR 0012).
 */
export class SealedForOthers {
	constructor(protected readonly secrets: Collection<TenantSecretDocument>) {}

	/** Seals the DNS API token for the provisioner; the IdP cannot read it back. */
	async putForProvisioner(
		tenantId: string,
		value: string,
		provisionerPublicKey: string,
	): Promise<void> {
		const kind = "dns-cloudflare";
		const sealed = sealForProvisioner(
			value,
			secretContext(tenantId, kind),
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

	/**
	 * Seals an AI key for Scribe (replacing the vendor's previous key and any
	 * status Scribe reported about it); the IdP cannot read it back.
	 */
	async putForScribe(
		tenantId: string,
		vendor: ScribeVendor,
		value: string,
		scribePublicKey: string,
	): Promise<void> {
		const kind = scribeKeyKind(vendor);
		const sealed = sealForRecipient(
			value,
			secretContext(tenantId, kind),
			scribePublicKey,
		);
		await this.secrets.replaceOne(
			{ _id: `${tenantId}:${kind}` },
			{
				tenantId,
				kind,
				sealed,
				forProvisioner: true,
				sealedFor: "scribe",
				hint: value.slice(-4),
				updatedAt: new Date(),
			},
			{ upsert: true },
		);
	}

	/** The tenant's AI keys as stored (sealed), in the order of SCRIBE_VENDORS. */
	async sealedForScribe(tenantId: string): Promise<ScribeSealedKey[]> {
		const documents = await this.secrets
			.find({
				_id: {
					$in: SCRIBE_VENDORS.map((v) => `${tenantId}:${scribeKeyKind(v)}`),
				},
				tenantId,
				sealedFor: "scribe",
			})
			.toArray();
		return SCRIBE_VENDORS.flatMap((vendor): ScribeSealedKey[] => {
			const document = documents.find((d) => d.kind === scribeKeyKind(vendor));
			if (!document || !isRecipientSealed(document.sealed)) return [];
			return [
				{
					vendor,
					hint: document.hint ?? "",
					updatedAt: document.updatedAt,
					...(document.status ? { status: document.status } : {}),
					...(document.statusAt ? { statusAt: document.statusAt } : {}),
					sealed: document.sealed,
				},
			];
		});
	}

	/**
	 * Records what Scribe reported about a key, only while the stored key is
	 * the one it opened (same recipient): a report about a key the owner has
	 * replaced since does not mark the new one. True when recorded.
	 */
	async setScribeStatus(
		tenantId: string,
		vendor: ScribeVendor,
		recipient: string,
		status: ScribeKeyStatus,
	): Promise<boolean> {
		const result = await this.secrets.updateOne(
			{
				_id: `${tenantId}:${scribeKeyKind(vendor)}`,
				tenantId,
				sealedFor: "scribe",
				"sealed.recipient": recipient,
			},
			{ $set: { status, statusAt: new Date() } },
		);
		return result.matchedCount === 1;
	}
}
