import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TENANT_COLLECTIONS } from "../tenants/tenant-collections.js";

/*
 * The script that exports a tenant moving to its own servers (ADR 0007 §7)
 * names the IdP's collections itself: it must name every one with
 * tenantId, or part of the tenant would stay behind.
 */

const SCRIPT = join(
	import.meta.dirname,
	"../../deploy/self-hosted/migrate/export-tenant.sh",
);

describe("the tenant export script", () => {
	it("dumps exactly the IdP's tenant collections", () => {
		const source = readFileSync(SCRIPT, "utf8");
		const list = /^IDP_COLLECTIONS="([^"]*)"/m.exec(source)?.[1];
		expect(list).toBeDefined();
		const named = (list ?? "").split(/\s+/).filter(Boolean);
		expect([...named].sort()).toEqual([...TENANT_COLLECTIONS].sort());
	});
});
