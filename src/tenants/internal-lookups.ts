import { request } from "node:http";
import type { Db } from "mongodb";
import { AccountRepository } from "../accounts/account-repository.js";
import { AuditOutbox } from "../audit/audit-outbox.js";
import type { Logger } from "../logger.js";
import type { SigningJwks } from "../oidc/jwks.js";
import type { TenantRegistry } from "./tenant-registry.js";
import { resourcesFor } from "./tenant-resources.js";
import type { Tenant } from "./tenant.js";
import { normalizeTenantDomain } from "./tenant.js";

/**
 * Domains a Host may belong to: `auth.`, `localman.`, `tunnel.`, `scribe.` of
 * the domain, or one label under `localman.`/`tunnel.` (mocks, tunnels).
 */
export function tenantDomainCandidates(host: string): string[] {
	const normalized = normalizeTenantDomain(host);
	if (!normalized) return [];
	const labels = normalized.split(".");
	const candidates: string[] = [];
	const [first, second] = labels;
	if (first && ["auth", "localman", "tunnel", "scribe"].includes(first)) {
		candidates.push(labels.slice(1).join("."));
	}
	if (second && ["localman", "tunnel"].includes(second)) {
		candidates.push(labels.slice(2).join("."));
	}
	return candidates.flatMap((domain) => {
		const valid = normalizeTenantDomain(domain);
		return valid ? [valid] : [];
	});
}

const PUBLIC_MEMBERS = ["kty", "crv", "x", "y", "n", "e", "kid", "alg", "use"];

/** The public half of each key; private members never leave the IdP. */
export function publicJwks(jwks: SigningJwks): { keys: object[] } {
	return {
		keys: jwks.keys.map((key) =>
			Object.fromEntries(
				Object.entries(key).filter(([name]) => PUBLIC_MEMBERS.includes(name)),
			),
		),
	};
}

/**
 * The tenant's discovery document exactly as its provider serves it, read
 * from the public listener on loopback with the tenant's Host (fetch cannot
 * set Host, hence node:http). Loopback is a trusted proxy, so the forwarded
 * protocol makes the issuer https as on the Internet.
 */
export function discoveryOf(
	origin: string,
	issuer: URL,
): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const req = request(
			new URL("/.well-known/openid-configuration", origin),
			{
				headers: {
					host: issuer.host,
					"x-forwarded-proto": issuer.protocol.replace(":", ""),
				},
				timeout: 5_000,
			},
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => {
					body += chunk;
				});
				res.on("end", () => resolve({ status: res.statusCode ?? 502, body }));
			},
		);
		req.once("timeout", () => req.destroy(new Error("discovery timed out")));
		req.once("error", reject);
		req.end();
	});
}

export interface SummaryDependencies {
	readonly db: Db;
	readonly registry: TenantRegistry;
	readonly logger: Logger;
	readonly primaryTenantId: string;
}

/** The tenant's accounts linked to its owner's identity (none for the primary). */
async function ownerSubsOf(
	tenant: Tenant,
	deps: SummaryDependencies,
): Promise<string[]> {
	if (tenant.id === deps.primaryTenantId) return [];
	const owner = (await deps.registry.findById(tenant.id))?.owner;
	if (!owner) return [];
	const accounts = new AccountRepository(
		deps.db,
		tenant,
		new AuditOutbox(deps.db, tenant, deps.logger),
	);
	const account = await accounts.findByProvider(
		owner.provider,
		owner.providerId,
	);
	return account ? [account._id] : [];
}

/**
 * What an app may know about a tenant: nothing secret. `ownerSubs` are the
 * tenant's accounts linked to its owner's identity (Localman makes them
 * its admins there); empty for the primary tenant, whose apps configure
 * their own.
 */
export async function tenantSummary(
	tenant: Tenant,
	deps: SummaryDependencies,
): Promise<object> {
	return {
		ownerSubs: await ownerSubsOf(tenant, deps),
		id: tenant.id,
		domain: tenant.domain,
		displayName: tenant.displayName,
		issuer: tenant.issuer,
		status: tenant.status,
		resources: resourcesFor(tenant.domain),
		webApps: tenant.webApps,
	};
}
