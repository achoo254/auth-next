import type { UpstreamProvider } from "../accounts/user-model.js";
import type { TenantHosting } from "../tenants/tenant.js";

/** Ways to reach or vouch for an account that can be linked and unlinked. */
export type LinkedMethod = UpstreamProvider | "telegram";

/** What a tenant owner configures at /admin. */
export type TenantSetting =
	| "display-name"
	| "google"
	| "github"
	| "dns-cloudflare"
	| "telegram";

/** Why sessions or grants were revoked. */
export type RevocationCause = "account-page" | "token-revocation";

/**
 * Credential events sent to Localman, and the data each carries. Data never
 * holds a secret: no code, token, link or provider credential.
 */
export type AuditEventData = {
	"login.succeeded": { readonly methods: readonly string[] };
	"method.linked": { readonly method: LinkedMethod };
	"method.unlinked": { readonly method: LinkedMethod };
	/** The account lost its unverified email to the email's proven owner. */
	"email.reclaimed": Record<string, never>;
	/** The person deleted their account (ADR 0009): nothing of it is left. */
	"account.deleted": { readonly source: "web" | "app" };
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
	/** A domain became a tenant; `sub` is the owner's identity (`google:<id>`). */
	"tenant.claimed": {
		readonly domain: string;
		readonly hosting: TenantHosting;
	};
	/** The owner changed a setting (never its value). */
	"tenant.configured": { readonly setting: TenantSetting };
	"tenant.suspended": { readonly reason: string };
	/** The owner started moving an active tenant to its own servers, or cancelled it. */
	"tenant.migrating": { readonly domain: string };
	"tenant.migration_cancelled": { readonly domain: string };
	/** A self-hosted tenant's install enrolled: it now runs on its owner's servers. */
	"tenant.self_hosted": { readonly domain: string };
	/** A self-hosted tenant's entry was removed (TXT gone, never enrolled). */
	"tenant.released": { readonly reason: string };
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
