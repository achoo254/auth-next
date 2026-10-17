import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { freemem } from "node:os";
import type { Db } from "mongodb";
import type { Env } from "../config/env.js";
import type { Logger } from "../logger.js";
import {
	type OwnershipResolver,
	SYSTEM_RESOLVER,
} from "./ownership-records.js";
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
	readonly telegramApiBaseUrl: string;
	/** Where owners start and open /admin from: the primary tenant's /claim. */
	readonly claimUrl: string;
	readonly fetch: typeof fetch;
	readonly logger: Logger;
	availableMemoryMb(): number;
	/** A tenant's settings or status changed: its runtime is rebuilt. */
	changed(tenantId: string): void;
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

/** The Tenancy of a server whose registry tenants are enabled. */
/** Network and machine facts tests replace (DNS, HTTP, free memory). */
export type TenancyOverrides = Partial<
	Pick<Tenancy, "resolver" | "fetch" | "availableMemoryMb">
>;

export async function createTenancy(
	env: Env,
	db: Db,
	logger: Logger,
	stores: {
		readonly registry: TenantRegistry;
		readonly secrets: TenantSecrets;
	},
	changed: (tenantId: string) => void,
	overrides: TenancyOverrides = {},
): Promise<Tenancy> {
	const keyPath = env.PROVISIONER_PUBLIC_KEY_PATH;
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
		telegramApiBaseUrl: env.TELEGRAM_API_BASE_URL.replace(/\/+$/, ""),
		claimUrl: `${env.ISSUER}/claim`,
		fetch,
		logger,
		availableMemoryMb,
		changed,
		...overrides,
	};
}
