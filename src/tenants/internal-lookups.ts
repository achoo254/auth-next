import { request } from "node:http";
import type { SigningJwks } from "../oidc/jwks.js";
import { normalizeTenantDomain } from "./tenant.js";

/**
 * Domains a Host may belong to: `auth.`, `localman.`, `tunnel.` of the
 * domain, or one label under `localman.`/`tunnel.` (mocks, tunnels).
 */
export function tenantDomainCandidates(host: string): string[] {
	const normalized = normalizeTenantDomain(host);
	if (!normalized) return [];
	const labels = normalized.split(".");
	const candidates: string[] = [];
	const [first, second] = labels;
	if (first && ["auth", "localman", "tunnel"].includes(first)) {
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
