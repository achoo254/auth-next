import { randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";
import type { Logger } from "../logger.js";
import type { TenantDocument, TenantRegistry } from "./tenant-registry.js";
import { appHostsFor } from "./tenant.js";

/** DNS lookups the check needs; tests pass a fake. */
export interface OwnershipResolver {
	resolveTxt(name: string): Promise<string[][]>;
	resolve4(name: string): Promise<string[]>;
}

export const SYSTEM_RESOLVER: OwnershipResolver = {
	resolveTxt: (name) => dns.resolveTxt(name),
	resolve4: (name) => dns.resolve4(name),
};

/** Where the claim TXT record lives. */
export function claimTxtName(domain: string): string {
	return `_auth-claim.${domain}`;
}

async function lookup<T>(run: () => Promise<T[]>): Promise<T[]> {
	try {
		return await run();
	} catch {
		// NXDOMAIN, no data, timeout: all count as "not pointing here".
		return [];
	}
}

/**
 * What a domain must keep to stay a tenant: the claim TXT value, and every
 * app hostname (wildcards probed with a random label) resolving to this
 * service's address only. A record behind a CDN proxy fails, since
 * certificates and two-level wildcards need DNS-only records.
 */
export async function ownershipHolds(
	domain: string,
	expectedTxt: string,
	serviceIp: string,
	resolver: OwnershipResolver,
): Promise<boolean> {
	const txt = await lookup(() => resolver.resolveTxt(claimTxtName(domain)));
	if (!txt.some((chunks) => chunks.join("") === expectedTxt)) return false;
	const hosts = appHostsFor(domain);
	const probe = randomBytes(6).toString("hex");
	const names = [
		hosts.auth,
		hosts.localman,
		hosts.tunnel,
		hosts.localmanWildcard.replace("*", probe),
		hosts.tunnelWildcard.replace("*", probe),
	];
	for (const name of names) {
		const addresses = await lookup(() => resolver.resolve4(name));
		if (addresses.length === 0 || addresses.some((ip) => ip !== serviceIp)) {
			return false;
		}
	}
	return true;
}

/** Failed checks in a row that suspend a tenant (DNS hiccups are forgiven). */
export const SUSPEND_AFTER_FAILURES = 3;

export interface OwnershipCheckDependencies {
	readonly registry: TenantRegistry;
	readonly resolver: OwnershipResolver;
	readonly serviceIp: string;
	readonly logger: Logger;
	/** Called once a tenant is suspended (drops its runtime). */
	readonly onSuspended: (tenant: TenantDocument) => void;
}

/**
 * Re-checks every serving tenant's ownership. A domain that changed hands
 * (TXT gone) or no longer points here fails; after several failures in a
 * row the tenant is suspended: no pages, no tokens, no certificate work.
 */
export async function checkAllOwnership(
	deps: OwnershipCheckDependencies,
): Promise<{ checked: number; suspended: number }> {
	let suspended = 0;
	const tenants = await deps.registry.listServing();
	for (const tenant of tenants) {
		const ok =
			tenant.claimTxt !== undefined &&
			(await ownershipHolds(
				tenant.domain,
				tenant.claimTxt,
				deps.serviceIp,
				deps.resolver,
			));
		const failures = await deps.registry.recordOwnershipCheck(tenant._id, ok);
		if (!ok && failures >= SUSPEND_AFTER_FAILURES) {
			await deps.registry.update(tenant._id, {
				status: "suspended",
				suspendedAt: new Date(),
				suspendedReason: "ownership",
			});
			deps.onSuspended(tenant);
			deps.logger.warn(
				{ tenantId: tenant._id, domain: tenant.domain, failures },
				"Tenant suspended: domain ownership no longer holds",
			);
			suspended += 1;
		}
	}
	return { checked: tenants.length, suspended };
}
