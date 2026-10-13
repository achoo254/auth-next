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

/** Answers that prove the name has no such record (not a resolver hiccup). */
const NO_RECORD_CODES: ReadonlySet<string> = new Set(["ENOTFOUND", "ENODATA"]);

class DnsUnavailable extends Error {}

/**
 * Records of a name: an empty list when DNS says there are none; throws
 * DnsUnavailable when the resolver could not answer (timeout, SERVFAIL,
 * refused), which proves nothing either way.
 */
async function lookup<T>(run: () => Promise<T[]>): Promise<T[]> {
	try {
		return await run();
	} catch (error) {
		const code: unknown =
			error instanceof Error ? Reflect.get(error, "code") : undefined;
		if (typeof code === "string" && NO_RECORD_CODES.has(code)) return [];
		throw new DnsUnavailable();
	}
}

/**
 * Which part of the ownership proof failed, if any; "unknown" when DNS
 * could not be asked (no conclusion about the domain).
 */
export type OwnershipResult = "ok" | "txt" | "address" | "unknown";

/**
 * What a domain must hold to be (and stay) a tenant: the claim TXT value,
 * and every app hostname (wildcards probed with a random label) resolving
 * to this service's address only. A record behind a CDN proxy fails, since
 * certificates and two-level wildcards need DNS-only records.
 */
export async function checkOwnership(
	domain: string,
	expectedTxt: string,
	serviceIp: string,
	resolver: OwnershipResolver,
): Promise<OwnershipResult> {
	try {
		return await checkRecords(domain, expectedTxt, serviceIp, resolver);
	} catch (error) {
		if (error instanceof DnsUnavailable) return "unknown";
		throw error;
	}
}

async function checkRecords(
	domain: string,
	expectedTxt: string,
	serviceIp: string,
	resolver: OwnershipResolver,
): Promise<OwnershipResult> {
	const txt = await lookup(() => resolver.resolveTxt(claimTxtName(domain)));
	if (!txt.some((chunks) => chunks.join("") === expectedTxt)) return "txt";
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
			return "address";
		}
	}
	return "ok";
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
/** How often each tenant is re-checked. */
export const OWNERSHIP_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Re-checks tenants not checked for OWNERSHIP_CHECK_EVERY_MS. A domain that
 * changed hands (TXT gone) or no longer points here fails; after several
 * definite failures in a row the tenant is suspended: no pages, no tokens,
 * no certificate work. A resolver that cannot answer proves nothing, and a
 * round where every tenant fails looks like a local DNS fault, so nobody
 * is suspended by it.
 */
export async function checkAllOwnership(
	deps: OwnershipCheckDependencies,
): Promise<{ checked: number; suspended: number }> {
	const due = await deps.registry.listDueForOwnershipCheck(
		new Date(Date.now() - OWNERSHIP_CHECK_EVERY_MS),
	);
	const results = await Promise.all(
		due.map(async (tenant) => ({
			tenant,
			result: tenant.claimTxt
				? await checkOwnership(
						tenant.domain,
						tenant.claimTxt,
						deps.serviceIp,
						deps.resolver,
					)
				: ("txt" as const),
		})),
	);
	const failed = results.filter(
		({ result }) => result === "txt" || result === "address",
	);
	if (results.length > 1 && failed.length === results.length) {
		deps.logger.warn(
			{ checked: results.length },
			"Every tenant failed its ownership check; suspecting local DNS, nobody suspended",
		);
		return { checked: 0, suspended: 0 };
	}
	let suspended = 0;
	for (const { tenant, result } of results) {
		if (result === "unknown") continue;
		const failures = await deps.registry.recordOwnershipCheck(
			tenant._id,
			result === "ok",
		);
		if (result !== "ok" && failures >= SUSPEND_AFTER_FAILURES) {
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
	return { checked: results.length, suspended };
}
