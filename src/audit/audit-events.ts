import type { UpstreamProvider } from "../accounts/user-model.js";

/** Ways to reach or vouch for an account that can be linked and unlinked. */
export type LinkedMethod = UpstreamProvider | "telegram";

/** Why sessions or grants were revoked. */
export type RevocationCause =
	| "account-page"
	| "password-change"
	| "password-reset"
	| "security-review"
	| "token-revocation";

/**
 * Credential events sent to Localman, and the data each carries. Data never
 * holds a secret: no password, code, token, link or provider credential.
 */
export type AuditEventData = {
	"login.succeeded": { readonly methods: readonly string[] };
	/**
	 * A secret was checked and was wrong, or a Google/GitHub sign-in was
	 * refused because the account owes its post-reset security review.
	 * Attempts refused by a lock are not recorded (no secret was checked).
	 */
	"login.failed": {
		readonly method: "password" | "recovery-code" | "federated";
		readonly reason: "invalid" | "review-pending";
		/** Which provider, for a federated sign-in when known. */
		readonly provider?: UpstreamProvider;
	};
	/** Wrong attempts just locked the account for this method. */
	"login.locked": { readonly method: "password" | "recovery-code" };
	"password.changed": Record<string, never>;
	"password.reset": { readonly via: "recovery-code" | "reset-link" };
	"recovery_codes.regenerated": Record<string, never>;
	"method.linked": { readonly method: LinkedMethod };
	"method.unlinked": { readonly method: LinkedMethod };
	/** The account lost its unverified email to the email's proven owner. */
	"email.reclaimed": Record<string, never>;
	/** A Tunelo device was approved or a third-party (MCP) app consented. */
	"grant.created": {
		readonly clientId: string;
		readonly kind: "device" | "third-party-app";
		readonly deviceName?: string;
	};
	"session.revoked": {
		readonly count: number;
		readonly cause: RevocationCause;
	};
	"grant.revoked": {
		readonly count: number;
		readonly cause: RevocationCause;
		readonly clientId?: string;
	};
	/** RP-initiated logout at the IdP: everywhere, or only from one app. */
	"session.logout": {
		readonly scope: "all" | "client";
		readonly clientId?: string;
	};
};

export type AuditEventType = keyof AuditEventData;

/** A stored event's data, whatever its type. */
export type AuditData = Readonly<
	Record<string, string | number | readonly string[] | undefined>
>;

/** Where the request that caused the event came from, when there was one. */
export interface AuditContext {
	readonly ip?: string;
	readonly userAgent?: string;
}

/** SET event identifiers are URIs (RFC 8417 §2.2); stable across deployments. */
export const AUDIT_EVENT_URI_PREFIX = "urn:hoandat:auth:event:";

export function auditEventUri(type: AuditEventType): string {
	return `${AUDIT_EVENT_URI_PREFIX}${type}`;
}
