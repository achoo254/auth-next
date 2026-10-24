import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { freemem } from "node:os";
import type { Db } from "mongodb";
import type { Env } from "../config/env.js";
import type { Logger } from "../logger.js";
import type { SigningJwks } from "../oidc/jwks.js";
import {
	type ChallengeFetcher,
	fetchChallenge,
} from "./enrollment-challenge.js";
import {
	type OwnershipResolver,
	SYSTEM_RESOLVER,
} from "./ownership-records.js";
import { recipientOf } from "./secret-keyring.js";
import { TenantClaims } from "./tenant-claims.js";
import type { TenantRegistry } from "./tenant-registry.js";
import type { TenantSecrets } from "./tenant-secrets.js";

/**
 * What claiming a domain and administering a tenant need, shared by the
 * primary tenant's /claim pages and every registry tenant's /admin pages.
 * Present only when registry tenants are enabled.
 */
export interface Tenancy {
	readonly db: Db;
	readonly registry: TenantRegistry;
	readonly claims: TenantClaims;
	readonly secrets: TenantSecrets;
	readonly resolver: OwnershipResolver;
	/** SERVICE_IPV4: claims are closed without it (nothing to point DNS at). */
	readonly serviceIp?: string;
	/** SELF_HOSTED_CLAIMS: /claim offers the self-hosted mode (ADR 0007). */
	readonly selfHostedClaims: boolean;
	readonly maxActive: number;
	readonly minAvailableMemoryMb: number;
	/** Domains (and everything under them) nobody may claim. */
	readonly blockedDomains: readonly string[];
	/** PEM of the provisioner's key; DNS tokens can be saved only with it. */
	readonly provisionerPublicKey?: string;
	/**
	 * Scribe's sealing key when SCRIBE_TENANTS is on and the key is set
	 * (ADR 0012): /admin offers AI keys only then.
	 */
	readonly scribe?: ScribeSealingKey;
	readonly telegramApiBaseUrl: string;
	/** Where owners start and open /admin from: the primary tenant's /claim. */
	readonly claimUrl: string;
	/** The primary tenant's issuer and keys: the gateway signing enrollment bundles. */
	readonly issuer: string;
	readonly signingJwks: SigningJwks;
	/** Asks a self-hosted install to answer an enrollment challenge. */
	readonly fetchChallenge: ChallengeFetcher;
	readonly fetch: typeof fetch;
	readonly logger: Logger;
	availableMemoryMb(): number;
	/** A tenant's settings or status changed: its runtime is rebuilt. */
	changed(tenantId: string): void;
}

/** Scribe's RSA public key (PEM) and its fingerprint. */
export interface ScribeSealingKey {
	readonly publicKey: string;
	readonly recipient: string;
}

/**
 * Reads Scribe's sealing key at startup; refuses anything but an RSA public
 * key of at least 3072 bits, so a wrong file stops the IdP at once rather
 * than when an owner saves a key. A private key is refused outright: with
 * it the IdP could open every tenant's AI keys.
 */
export async function readScribeSealingKey(
	path: string,
): Promise<ScribeSealingKey> {
	const pem = await readFile(path, "utf8");
	if (/PRIVATE KEY-----/.test(pem)) {
		throw new Error(
			"SCRIBE_SEALING_PUBLIC_KEY_PATH holds a private key: give the IdP Scribe's public key only",
		);
	}
	const key = createPublicKey(pem);
	const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
	if (key.asymmetricKeyType !== "rsa" || bits < 3072) {
		throw new Error(
			"SCRIBE_SEALING_PUBLIC_KEY_PATH must hold an RSA public key of at least 3072 bits",
		);
	}
	const publicKey = key.export({ type: "spki", format: "pem" }).toString();
	return { publicKey, recipient: recipientOf(publicKey) };
}

/**
 * Memory the system can still hand out: MemAvailable on Linux (free memory
 * plus reclaimable cache), free memory elsewhere.
 */
export function availableMemoryMb(): number {
	try {
		const meminfo = readFileSync("/proc/meminfo", "utf8");
		const kb = /^MemAvailable:\s+(\d+) kB$/m.exec(meminfo)?.[1];
		if (kb) return Math.floor(Number(kb) / 1024);
	} catch {
		// Not Linux.
	}
	return Math.floor(freemem() / 1024 / 1024);
}

/** Network and machine facts tests replace (DNS, HTTP, free memory). */
export type TenancyOverrides = Partial<
	Pick<Tenancy, "resolver" | "fetch" | "availableMemoryMb" | "fetchChallenge">
>;

/** The Tenancy of a server whose registry tenants are enabled. */
export async function createTenancy(
	env: Env,
	db: Db,
	logger: Logger,
	stores: {
		readonly registry: TenantRegistry;
		readonly secrets: TenantSecrets;
		readonly signingJwks: SigningJwks;
	},
	changed: (tenantId: string) => void,
	overrides: TenancyOverrides = {},
): Promise<Tenancy> {
	const keyPath = env.PROVISIONER_PUBLIC_KEY_PATH;
	const scribeKeyPath = env.SCRIBE_TENANTS
		? env.SCRIBE_SEALING_PUBLIC_KEY_PATH
		: undefined;
	return {
		db,
		registry: stores.registry,
		claims: new TenantClaims(db),
		secrets: stores.secrets,
		resolver: SYSTEM_RESOLVER,
		serviceIp: env.SERVICE_IPV4,
		selfHostedClaims: env.SELF_HOSTED_CLAIMS,
		maxActive: env.TENANT_MAX_ACTIVE,
		minAvailableMemoryMb: env.CLAIM_MIN_AVAILABLE_MB,
		// The primary domain and everything around it is never a tenant.
		blockedDomains: [env.TENANT_DOMAIN, ...env.CLAIM_BLOCKED_DOMAINS],
		provisionerPublicKey: keyPath ? await readFile(keyPath, "utf8") : undefined,
		scribe: scribeKeyPath
			? await readScribeSealingKey(scribeKeyPath)
			: undefined,
		telegramApiBaseUrl: env.TELEGRAM_API_BASE_URL.replace(/\/+$/, ""),
		claimUrl: `${env.ISSUER}/claim`,
		issuer: env.ISSUER,
		signingJwks: stores.signingJwks,
		fetchChallenge,
		fetch,
		logger,
		availableMemoryMb,
		changed,
		...overrides,
	};
}
