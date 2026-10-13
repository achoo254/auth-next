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
	/** The primary tenant's domain: no registry tenant may sit at, above or under it. */
	readonly primaryDomain: string;
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
	/** Builds in flight, by `<tenantId>:<configVersion>`. */
	private readonly building = new Map<string, Promise<TenantRuntime>>();
	/** Bumped by dispose, so a build that finishes afterwards is not kept. */
	private readonly generations = new Map<string, number>();
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
		const host = rawHost?.toLowerCase().replace(/\.$/, "");
		if (!host) return { kind: "unknown" };
		if (this.primaryHosts.has(host)) {
			return { kind: "found", runtime: this.options.primary };
		}
		const domain = authDomainOf(host);
		if (
			!domain ||
			overlaps(domain, this.options.primaryDomain) ||
			(this.unknownUntil.get(host) ?? 0) > this.now()
		) {
			return { kind: "unknown" };
		}
		const document = await this.options.registry.findByDomain(domain);
		if (!document || !SERVING_STATUSES.includes(document.status)) {
			this.rememberUnknown(host);
			return { kind: "unknown" };
		}
		const version = document.configVersion ?? 0;
		const cached = this.runtimes.get(document._id);
		if (cached && cached.version >= version) {
			return { kind: "found", runtime: cached };
		}
		const buildingIds = new Set(
			[...this.building.keys()].map((key) => key.split(":")[0]),
		);
		const slots = new Set([...this.runtimes.keys(), ...buildingIds]);
		if (!slots.has(document._id) && slots.size >= this.options.maxActive) {
			this.options.logger.warn(
				{ tenantId: document._id, maxActive: this.options.maxActive },
				"Tenant runtime refused: TENANT_MAX_ACTIVE reached",
			);
			return { kind: "busy" };
		}
		return { kind: "found", runtime: await this.buildOnce(document) };
	}

	/**
	 * Drops a tenant's runtime (suspended, or changed and to be rebuilt);
	 * a build still running for it is not kept either.
	 */
	dispose(tenantId: string): void {
		this.runtimes.delete(tenantId);
		this.generations.set(tenantId, (this.generations.get(tenantId) ?? 0) + 1);
		this.unknownUntil.clear();
	}

	private buildOnce(document: TenantDocument): Promise<TenantRuntime> {
		const key = `${document._id}:${document.configVersion ?? 0}`;
		const pending = this.building.get(key);
		if (pending) return pending;
		const generation = this.generations.get(document._id) ?? 0;
		const build = this.options
			.build(document)
			.then((runtime) => {
				const current = this.runtimes.get(document._id);
				const disposed =
					(this.generations.get(document._id) ?? 0) !== generation;
				if (!disposed && (!current || current.version < runtime.version)) {
					this.runtimes.set(document._id, runtime);
				}
				return runtime;
			})
			.finally(() => this.building.delete(key));
		this.building.set(key, build);
		return build;
	}

	private rememberUnknown(host: string): void {
		if (this.unknownUntil.size >= MAX_NEGATIVE_ENTRIES) {
			this.unknownUntil.clear();
		}
		this.unknownUntil.set(host, this.now() + UNKNOWN_HOST_TTL_MS);
	}
}

/** True when one domain is the other or lies under it. */
function overlaps(a: string, b: string): boolean {
	return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/** `auth.<domain>` → the domain; any other shape is not a tenant IdP host. */
export function authDomainOf(host: string): string | undefined {
	const normalized = normalizeTenantDomain(host);
	if (!normalized?.startsWith("auth.")) return undefined;
	return normalizeTenantDomain(normalized.slice("auth.".length));
}
