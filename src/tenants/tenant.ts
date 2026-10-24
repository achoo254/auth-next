import { domainToASCII } from "node:url";
import { parse } from "tldts";

/**
 * The one tenant this IdP serves (ADR 0013): `auth.<domain>` (this IdP),
 * `localman.<domain>`, `tunnel.<domain>`, `chat.<domain>` and the apps
 * configured beside them. Its id is stamped on every document as
 * `tenantId`, so data stays scoped exactly as before domain tenants went.
 */
export interface Tenant {
	/** Stamped as `tenantId` on every document the tenant owns. */
	readonly id: string;
	/** Normalised root domain (see normalizeTenantDomain). */
	readonly domain: string;
	/** Brand shown in every page and message instead of a fixed name. */
	readonly displayName: string;
	readonly issuer: string;
	/** Where the tenant's web apps live (redirect and logout URIs). */
	readonly webApps: {
		readonly localman: string;
		readonly tunelo: string;
		readonly chat: string;
		/** Scribe, once its client secret is configured. */
		readonly scribe?: string;
		/** Miu World, once its client secret is configured. */
		readonly miu?: string;
	};
}

/** The hostnames of a tenant, fixed by convention under its domain. */
export interface TenantAppHosts {
	readonly auth: string;
	readonly chat: string;
	readonly localman: string;
	readonly tunnel: string;
}

export function appHostsFor(domain: string): TenantAppHosts {
	return {
		auth: `auth.${domain}`,
		chat: `chat.${domain}`,
		localman: `localman.${domain}`,
		tunnel: `tunnel.${domain}`,
	};
}

const MAX_DOMAIN_LENGTH = 253;
/** Letters, digits and inner hyphens; punycode labels (xn--) fit too. */
const LDH_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Special-use names (RFC 6761, RFC 7686, RFC 8375, `.internal`): never in
 * public DNS, but a resolver of the server could answer for them.
 */
const RESERVED_TLDS: ReadonlySet<string> = new Set([
	"arpa",
	"example",
	"internal",
	"invalid",
	"local",
	"localhost",
	"onion",
	"test",
]);

/**
 * The canonical form of the tenant's domain (TENANT_DOMAIN), or undefined
 * when it is not a plain public hostname: lowercase LDH or punycode
 * labels, no port, no trailing dot, at most 253 characters, not an IP,
 * under a delegated public suffix (not a reserved or unknown TLD) without
 * being one (`com.vn`, `github.io`). Resources and audiences are built
 * from it.
 */
export function normalizeTenantDomain(input: string): string | undefined {
	const trimmed = input.trim().toLowerCase();
	// A port or a trailing dot is a harmless spelling; anything else odd is not.
	const withoutPort = trimmed.replace(/:\d{1,5}$/, "").replace(/\.$/, "");
	if (withoutPort.length === 0 || /[^\p{L}\p{N}.-]/u.test(withoutPort)) {
		return undefined;
	}
	const ascii = domainToASCII(withoutPort);
	if (ascii.length === 0 || ascii.length > MAX_DOMAIN_LENGTH) return undefined;
	const labels = ascii.split(".");
	if (labels.length < 2 || !labels.every((label) => LDH_LABEL.test(label))) {
		return undefined;
	}
	if (RESERVED_TLDS.has(labels[labels.length - 1] ?? "")) return undefined;
	const parsed = parse(ascii, { allowPrivateDomains: true });
	if (parsed.isIp || !parsed.domain || !parsed.publicSuffix) return undefined;
	if (!parsed.isIcann && !parsed.isPrivate) return undefined;
	return ascii;
}
