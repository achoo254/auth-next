import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tenant-owned collections are only reached through the modules that add
 * the tenant filter. Any other module calling `db.collection(...)` or
 * naming an oidc_* collection could read across tenants.
 */
const DATA_ACCESS_MODULES = new Set([
	"src/accounts/user-model.ts",
	"src/accounts/account-repository.ts",
	"src/audit/audit-outbox.ts",
	"src/accounts/one-time-tokens.ts",
	"src/audit/audit-outbox-model.ts",
	"src/oidc/mongo-adapter.ts",
	"src/oidc/oidc-indexes.ts",
	"src/oidc/sliding-grants.ts",
	"src/oidc/client-seed.ts",
	"src/account-portal/grant-directory.ts",
	"src/account-portal/device-grants.ts",
	"src/account-portal/session-directory.ts",
	"src/account-portal/revoke-access.ts",
	"src/account-portal/account-data-purge.ts",
	"src/push/push-devices.ts",
	"src/usage/client-usage-model.ts",
	// The growth report lists every tenant with data, then reads each one.
	"src/usage/growth-report-queries.ts",
	"src/tenants/tenant-collections.ts",
	"src/tenants/tenant-migration.ts",
	// The registry and sealed secrets are keyed by tenant id themselves;
	// the audit queue is the one deliberate all-tenants reader (dispatcher).
	"src/tenants/tenant-registry.ts",
	"src/tenants/tenant-lifecycle.ts",
	"src/tenants/tenant-secrets.ts",
	// Claims wait outside any tenant until verified, keyed by account.
	"src/tenants/tenant-claims.ts",
	"src/audit/audit-queue.ts",
	"src/services.ts",
]);

const ROOT = join(import.meta.dirname, "..", "..");

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			return entry.name === "__tests__" ? [] : sourceFiles(path);
		}
		return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
			? [path]
			: [];
	});
}

describe("tenant data access", () => {
	it("reaches MongoDB collections only from the tenant-aware modules", () => {
		const offenders = sourceFiles(join(ROOT, "src"))
			.map((path) => relative(ROOT, path).split(sep).join("/"))
			.filter((path) => !DATA_ACCESS_MODULES.has(path))
			.filter((path) =>
				/\.collection\s*[<(]|collectionNameFor\(|accountsCollection\(|auditOutboxCollection\(/.test(
					readFileSync(join(ROOT, path), "utf8"),
				),
			);
		expect(offenders).toEqual([]);
	});
});
