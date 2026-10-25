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
	readonly chatMcp: string;
}

export function resourcesFor(domain: string): TenantResources {
	const hosts = appHostsFor(domain);
	return {
		localman: `https://${hosts.localman}`,
		localmanMcp: `https://${hosts.localman}/mcp`,
		tunnel: `https://${hosts.tunnel}`,
		chatMcp: `https://${hosts.chat}/mcp`,
	};
}

/**
 * Web app origins of a domain by convention (where redirect and logout URIs
 * point). The chat web app has no API resource (it runs its own sessions and
 * only reads the ID token and userinfo); its only resource is the MCP
 * endpoint (`chatMcp`), so its origin comes from the host, not from
 * `resourcesFor`.
 */
export function webAppsFor(domain: string): {
	readonly localman: string;
	readonly tunelo: string;
	readonly chat: string;
} {
	const resources = resourcesFor(domain);
	return {
		localman: resources.localman,
		tunelo: resources.tunnel,
		chat: `https://${appHostsFor(domain).chat}`,
	};
}
