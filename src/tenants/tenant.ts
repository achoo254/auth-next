import { domainToASCII } from "node:url";
import { parse } from "tldts";

/**
 * Lifecycle of a tenant: a domain is claimed (TXT proven), becomes active
 * once it has an owner and a sign-in provider, and is suspended when its
 * ownership no longer checks out.
 */
export type TenantStatus = "pending_claim" | "claimed" | "active" | "suspended";

/**
 * One claimed domain and everything served under it: `auth.<domain>`
 * (this IdP), `localman.<domain>` and `tunnel.<domain>`. Accounts, sessions,
 * grants and tokens of one tenant never work in another.
 */
export interface Tenant {
	/** Stamped as `tenantId` on every document the tenant owns. */
	readonly id: string;
	/** Normalised root domain (see normalizeTenantDomain). */
	readonly domain: string;
	/** Brand shown in every page and message instead of a fixed name. */
	readonly displayName: string;
	readonly issuer: string;
	readonly status: TenantStatus;
	/** Where the tenant's web apps live (redirect and logout URIs). */
	readonly webApps: { readonly localman: string; readonly tunelo: string };
}

/** The hostnames of a tenant, fixed by convention under its domain. */
export interface TenantAppHosts {
	readonly auth: string;
	readonly localman: string;
	readonly localmanWildcard: string;
	readonly tunnel: string;
	readonly tunnelWildcard: string;
}

export function appHostsFor(domain: string): TenantAppHosts {
	return {
		auth: `auth.${domain}`,
		localman: `localman.${domain}`,
		localmanWildcard: `*.localman.${domain}`,
		tunnel: `tunnel.${domain}`,
		tunnelWildcard: `*.tunnel.${domain}`,
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

/** True when `domain` is `blocked` or lies under it. */
function isUnder(domain: string, blocked: string): boolean {
	return domain === blocked || domain.endsWith(`.${blocked}`);
}

/**
 * The canonical form of a domain someone wants to claim, or undefined when
 * it can never be a tenant. Domains end up in DNS lookups, certbot
 * arguments and nginx certificate paths, so only plain hostnames pass:
 * lowercase LDH or punycode labels, no port, no trailing dot, at most 253
 * characters, not an IP, under a delegated public suffix (not a reserved
 * or unknown TLD) without being one (`com.vn`, `github.io`), and neither
 * equal to nor under a `blocked` domain (normalised the same way).
 */
export function normalizeTenantDomain(
	input: string,
	blocked: readonly string[] = [],
): string | undefined {
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
	const blockedDomains = blocked.flatMap((domain) => {
		const normalized = normalizeTenantDomain(domain);
		return normalized ? [normalized] : [];
	});
	if (blockedDomains.some((domain) => isUnder(ascii, domain))) {
		return undefined;
	}
	return ascii;
}
