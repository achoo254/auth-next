import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

/** Who may call the internal API, and what for. */
export type InternalRole = "localman" | "tunelo" | "provisioner" | "scribe";

const ROLES: ReadonlySet<string> = new Set([
	"localman",
	"tunelo",
	"provisioner",
	"scribe",
]);

export type InternalCredentials = ReadonlyMap<InternalRole, string>;

function isRole(value: string): value is InternalRole {
	return ROLES.has(value);
}

/**
 * Parses `INTERNAL_API_CREDENTIALS`: `role:secret[,role:secret...]` with
 * roles localman, tunelo, provisioner, scribe and secrets of 32+ characters.
 * Each app gets its own secret, so one leaked secret only opens its own routes.
 */
export function parseInternalCredentials(
	value: string | undefined,
): InternalCredentials {
	const credentials = new Map<InternalRole, string>();
	for (const part of (value ?? "").split(",")) {
		const entry = part.trim();
		if (!entry) continue;
		const separator = entry.indexOf(":");
		const role = entry.slice(0, separator);
		const secret = entry.slice(separator + 1);
		if (separator <= 0 || !isRole(role) || secret.length < 32) {
			throw new Error(
				"INTERNAL_API_CREDENTIALS entries must be role:secret (roles localman, tunelo, provisioner, scribe; secrets of 32+ characters)",
			);
		}
		credentials.set(role, secret);
	}
	return credentials;
}

function digest(value: string): Buffer {
	return createHash("sha256").update(value, "utf8").digest();
}

/** The role whose Basic credentials the request carries, compared in constant time. */
function authenticatedRole(
	header: string | undefined,
	credentials: InternalCredentials,
): InternalRole | undefined {
	const match = /^Basic ([A-Za-z0-9+/=]+)$/.exec(header ?? "");
	if (!match?.[1]) return undefined;
	const decoded = Buffer.from(match[1], "base64").toString("utf8");
	const separator = decoded.indexOf(":");
	if (separator <= 0) return undefined;
	const role = decoded.slice(0, separator);
	const secret = decoded.slice(separator + 1);
	if (!isRole(role)) return undefined;
	const expected = credentials.get(role);
	if (!expected) return undefined;
	return timingSafeEqual(digest(secret), digest(expected)) ? role : undefined;
}

/** Lets only the listed roles through; 401 (with a challenge) otherwise. */
export function requireRole(
	credentials: InternalCredentials,
	allowed: readonly InternalRole[],
): RequestHandler {
	return (req, res, next) => {
		const role = authenticatedRole(req.headers.authorization, credentials);
		if (role && allowed.includes(role)) {
			next();
			return;
		}
		res
			.status(401)
			.set("www-authenticate", 'Basic realm="internal"')
			.json({ error: "unauthorized" });
	};
}
