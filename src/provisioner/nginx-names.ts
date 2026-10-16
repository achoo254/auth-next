import { appHostsFor } from "../tenants/tenant.js";

/** The tenant blocks' own regexes (infra/nginx); they never clash with a tenant. */
const TENANT_BLOCK_PATTERN = /\(\?P?<tenant>|\(\?<d>/;

/** Every name of every `server_name` directive, unquoted, lowercase. */
export function configuredServerNames(config: string): string[] {
	const names: string[] = [];
	for (const match of config.matchAll(/(?:^|[\s;{])server_name\s+([^;]+);/g)) {
		for (const raw of (match[1] ?? "").split(/\s+/)) {
			const name = raw.replace(/^["']|["']$/g, "");
			if (name && name !== "_")
				names.push(name.startsWith("~") ? name : name.toLowerCase());
		}
	}
	return names;
}

/** Whether nginx would route `host` to a block carrying `name`. */
function serves(name: string, host: string): boolean {
	if (name.startsWith("~")) {
		const source = name.slice(1).replace(/\(\?P</g, "(?<");
		try {
			return new RegExp(source, "i").test(host);
		} catch {
			// A regex JavaScript cannot read: assume the worst.
			return true;
		}
	}
	const plain = name.replace(/\.$/, "");
	if (plain.startsWith("*.")) return host.endsWith(plain.slice(1));
	if (plain.startsWith("."))
		return host === plain.slice(1) || host.endsWith(plain);
	if (plain.endsWith(".*")) return host.startsWith(plain.slice(0, -1));
	return host === plain;
}

/**
 * A tenant hostname another server block already serves (exactly, through
 * a wildcard or a regex): issuing would hand that app's traffic to the
 * tenant, so the provisioner refuses. The tenants' own regex blocks are
 * skipped. Wildcard hosts are checked with a probe label.
 */
export function conflictingName(
	domain: string,
	names: readonly string[],
): string | undefined {
	const hosts = appHostsFor(domain);
	const probes = [
		hosts.auth,
		hosts.chat,
		hosts.localman,
		hosts.tunnel,
		hosts.localmanWildcard.replace("*", "probe-label"),
		hosts.tunnelWildcard.replace("*", "probe-label"),
	];
	for (const name of names) {
		if (name.startsWith("~") && TENANT_BLOCK_PATTERN.test(name)) continue;
		const host = probes.find((probe) => serves(name, probe));
		if (host) return host;
	}
	return undefined;
}
