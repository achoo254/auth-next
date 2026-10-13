import type { Logger } from "../logger.js";
import {
	SERVING_STATUSES,
	type TenantDocument,
	type TenantRegistry,
} from "./tenant-registry.js";
import type { TenantRuntime } from "./tenant-runtime.js";
import { normalizeTenantDomain } from "./tenant.js";

/** Why a Host gets no tenant: unknown (421) or over capacity (503). */
export type RuntimeLookup =
	| { readonly kind: "found"; readonly runtime: TenantRuntime }
	| { readonly kind: "unknown" }
	| { readonly kind: "busy" };

const UNKNOWN_HOST_TTL_MS = 60_000;
const MAX_NEGATIVE_ENTRIES = 10_000;

export interface RuntimeRegistryOptions {
	/** The primary tenant, pinned: served for these Host values. */
	readonly primary: TenantRuntime;
	readonly primaryHosts: readonly string[];
	readonly registry: TenantRegistry;
	readonly build: (document: TenantDocument) => Promise<TenantRuntime>;
	/** TENANT_MAX_ACTIVE: registry tenants held in memory at most. */
	readonly maxActive: number;
	readonly logger: Logger;
	readonly now?: () => number;
}

/**
 * Picks the tenant serving a Host. The primary tenant is built at startup
 * and pinned. A registry tenant is served at `auth.<domain>` once claimed:
 * its runtime is built on first request (one build at a time per tenant,
 * concurrent requests wait for it), then kept; it is never evicted, only
 * dropped when the tenant is suspended. At most `maxActive` registry
 * runtimes exist; claiming refuses new domains before that is reached.
 * Unknown hosts are remembered for a minute so floods of random Hosts do
 * not each query MongoDB.
 */
export class RuntimeRegistry {
	private readonly runtimes = new Map<string, TenantRuntime>();
	private readonly building = new Map<string, Promise<TenantRuntime>>();
	private readonly unknownUntil = new Map<string, number>();
	private readonly primaryHosts: ReadonlySet<string>;
	private readonly now: () => number;

	constructor(private readonly options: RuntimeRegistryOptions) {
		this.primaryHosts = new Set(
			options.primaryHosts.map((host) => host.toLowerCase()),
		);
		this.now = options.now ?? Date.now;
	}

	get activeCount(): number {
		return this.runtimes.size;
	}

	async lookup(rawHost: string | undefined): Promise<RuntimeLookup> {
		const host = rawHost?.toLowerCase();
		if (!host) return { kind: "unknown" };
		if (this.primaryHosts.has(host)) {
			return { kind: "found", runtime: this.options.primary };
		}
		const domain = authDomainOf(host);
		if (!domain || (this.unknownUntil.get(host) ?? 0) > this.now()) {
			return { kind: "unknown" };
		}
		const document = await this.options.registry.findByDomain(domain);
		if (!document || !SERVING_STATUSES.includes(document.status)) {
			this.rememberUnknown(host);
			return { kind: "unknown" };
		}
		const cached = this.runtimes.get(document._id);
		if (cached) return { kind: "found", runtime: cached };
		if (
			!this.building.has(document._id) &&
			this.runtimes.size + this.building.size >= this.options.maxActive
		) {
			this.options.logger.warn(
				{ tenantId: document._id, maxActive: this.options.maxActive },
				"Tenant runtime refused: TENANT_MAX_ACTIVE reached",
			);
			return { kind: "busy" };
		}
		return { kind: "found", runtime: await this.buildOnce(document) };
	}

	/** Drops a suspended tenant's runtime; its next request finds no tenant. */
	dispose(tenantId: string): void {
		this.runtimes.delete(tenantId);
		this.unknownUntil.clear();
	}

	private buildOnce(document: TenantDocument): Promise<TenantRuntime> {
		const pending = this.building.get(document._id);
		if (pending) return pending;
		const build = this.options
			.build(document)
			.then((runtime) => {
				this.runtimes.set(document._id, runtime);
				return runtime;
			})
			.finally(() => this.building.delete(document._id));
		this.building.set(document._id, build);
		return build;
	}

	private rememberUnknown(host: string): void {
		if (this.unknownUntil.size >= MAX_NEGATIVE_ENTRIES) {
			this.unknownUntil.clear();
		}
		this.unknownUntil.set(host, this.now() + UNKNOWN_HOST_TTL_MS);
	}
}

/** `auth.<domain>` → the domain; any other shape is not a tenant IdP host. */
export function authDomainOf(host: string): string | undefined {
	const normalized = normalizeTenantDomain(host);
	if (!normalized?.startsWith("auth.")) return undefined;
	return normalizeTenantDomain(normalized.slice("auth.".length));
}
