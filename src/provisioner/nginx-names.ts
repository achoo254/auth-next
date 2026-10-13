import { appHostsFor } from "../tenants/tenant.js";

/**
 * Exact and wildcard names of every server block in `nginx -T` output
 * (regex names are skipped: the tenants' own blocks are regexes).
 */
export function configuredServerNames(dump: string): Set<string> {
	const names = new Set<string>();
	for (const match of dump.matchAll(/(?:^|[\s;{])server_name\s+([^;]+);/g)) {
		for (const name of (match[1] ?? "").split(/\s+/)) {
			if (name && !name.startsWith("~") && name !== "_") {
				names.add(name.toLowerCase().replace(/\.$/, ""));
			}
		}
	}
	return names;
}

/**
 * A tenant hostname another server block already serves (e.g. a retired
 * domain still configured): issuing would hand that app's traffic to the
 * tenant, so the provisioner refuses.
 */
export function conflictingName(
	domain: string,
	configured: ReadonlySet<string>,
): string | undefined {
	const hosts = appHostsFor(domain);
	const candidates = [
		hosts.auth,
		hosts.localman,
		hosts.tunnel,
		hosts.localmanWildcard,
		hosts.tunnelWildcard,
	];
	return candidates.find((name) => configured.has(name));
}
