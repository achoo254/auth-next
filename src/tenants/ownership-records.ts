import { randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";
import { isCloudflareIpv4 } from "./cloudflare-ips.js";
import { type TenantAppHosts, appHostsFor } from "./tenant.js";

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

/** An app host of a tenant, by its key in `TenantAppHosts`. */
export type AppHostKey = keyof TenantAppHosts;

export const APP_HOST_KEYS: readonly AppHostKey[] = [
	"auth",
	"chat",
	"localman",
	"localmanWildcard",
	"tunnel",
	"tunnelWildcard",
];

export function isAppHostKey(value: string): value is AppHostKey {
	return (APP_HOST_KEYS as readonly string[]).includes(value);
}

export interface OwnershipCheck {
	readonly result: OwnershipResult;
	/** Hosts whose A records do not reach this service ("address" only). */
	readonly wrongHosts: readonly AppHostKey[];
}

/**
 * True when a host's A records reach this service: all of them are the
 * service address (DNS only), or all of them are Cloudflare's (proxied).
 * A mix, or any other address, does not.
 */
export function pointsHere(
	addresses: readonly string[],
	serviceIp: string,
): boolean {
	if (addresses.length === 0) return false;
	return (
		addresses.every((ip) => ip === serviceIp) ||
		addresses.every(isCloudflareIpv4)
	);
}

/**
 * What a domain must hold to be (and stay) a tenant: the claim TXT value,
 * and every app hostname (wildcards probed with a random label) reaching
 * this service, directly or through Cloudflare's proxy (`pointsHere`). The
 * TXT record is the proof of ownership; a proxied record only proves the
 * host goes through Cloudflare. Every host is checked, so the owner learns
 * all the records still to fix at once.
 */
export async function checkOwnershipRecords(
	domain: string,
	expectedTxt: string,
	serviceIp: string,
	resolver: OwnershipResolver,
): Promise<OwnershipCheck> {
	try {
		return await checkRecords(domain, expectedTxt, serviceIp, resolver);
	} catch (error) {
		if (error instanceof DnsUnavailable) {
			return { result: "unknown", wrongHosts: [] };
		}
		throw error;
	}
}

/** `checkOwnershipRecords` when only the outcome matters. */
export async function checkOwnership(
	domain: string,
	expectedTxt: string,
	serviceIp: string,
	resolver: OwnershipResolver,
): Promise<OwnershipResult> {
	return (await checkOwnershipRecords(domain, expectedTxt, serviceIp, resolver))
		.result;
}

async function checkRecords(
	domain: string,
	expectedTxt: string,
	serviceIp: string,
	resolver: OwnershipResolver,
): Promise<OwnershipCheck> {
	const txt = await lookup(() => resolver.resolveTxt(claimTxtName(domain)));
	if (!txt.some((chunks) => chunks.join("") === expectedTxt)) {
		return { result: "txt", wrongHosts: [] };
	}
	const hosts = appHostsFor(domain);
	const probe = randomBytes(6).toString("hex");
	const wrongHosts: AppHostKey[] = [];
	for (const key of APP_HOST_KEYS) {
		const name = hosts[key].replace("*", probe);
		const addresses = await lookup(() => resolver.resolve4(name));
		if (!pointsHere(addresses, serviceIp)) wrongHosts.push(key);
	}
	return { result: wrongHosts.length > 0 ? "address" : "ok", wrongHosts };
}
