import { appHostsFor } from "./tenant.js";

/**
 * Resource indicators (RFC 8707) of a tenant's apps; each is also the `aud`
 * of tokens for that app. They follow from the domain by convention, so the
 * apps compute the same values without asking the IdP.
 */
export interface TenantResources {
	readonly localman: string;
	readonly localmanMcp: string;
	readonly tunnel: string;
}

export function resourcesFor(domain: string): TenantResources {
	const hosts = appHostsFor(domain);
	return {
		localman: `https://${hosts.localman}`,
		localmanMcp: `https://${hosts.localman}/mcp`,
		tunnel: `https://${hosts.tunnel}`,
	};
}

/**
 * Web app origins of a tenant (where its redirect and logout URIs point).
 * Chat and Scribe have no API resource (they run their own sessions and
 * only read the ID token and userinfo), so their origins are not among
 * `resourcesFor`. Scribe is there only when `scribe` is true: Scribe on
 * tenants is enabled and the tenant turned it on (ADR 0012).
 */
export function webAppsFor(
	domain: string,
	options: { readonly scribe: boolean } = { scribe: false },
): {
	readonly localman: string;
	readonly tunelo: string;
	readonly chat: string;
	readonly scribe?: string;
} {
	const resources = resourcesFor(domain);
	return {
		localman: resources.localman,
		tunelo: resources.tunnel,
		chat: `https://${appHostsFor(domain).chat}`,
		...(options.scribe ? { scribe: `https://scribe.${domain}` } : {}),
	};
}
