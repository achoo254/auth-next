import type {
	ScribeKeyKind,
	ScribeKeyStatus,
	ScribeVendor,
} from "./scribe-vendors.js";
import type {
	ProvisionerSealedValue,
	RecipientSealedValue,
	SealedValue,
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
