import type { Db } from "mongodb";
import { AccountRepository } from "../../accounts/account-repository.js";
import { AuditOutbox } from "../../audit/audit-outbox.js";
import { type Brand, brandOf } from "../../i18n/translator.js";
import { createLogger } from "../../logger.js";
import { PRIMARY_TENANT_ID } from "../../tenants/env-tenant.js";
import { resourcesFor, webAppsFor } from "../../tenants/tenant-resources.js";
import type { Tenant } from "../../tenants/tenant.js";

/** The primary tenant as tests configure it (the env defaults: hoandat.com). */
export const PRIMARY_TEST_TENANT: Tenant = {
	id: PRIMARY_TENANT_ID,
	domain: "hoandat.com",
	displayName: "hoandat.com",
	issuer: "http://localhost:4500",
	webApps: {
		localman: "https://localman.hoandat.com",
		tunelo: "https://tunnel.hoandat.com",
		chat: "https://chat.hoandat.com",
	},
};

/** Brand of the primary tenant: what every existing page and message shows. */
export const TEST_BRAND: Brand = brandOf(PRIMARY_TEST_TENANT);

/** Resource indicators (audiences) of the primary test tenant. */
export const RESOURCES = resourcesFor(PRIMARY_TEST_TENANT.domain);

/** A second tenant, for isolation tests. */
export const OTHER_TEST_TENANT: Tenant = {
	id: "tenant-other",
	domain: "example.org",
	displayName: "Example",
	issuer: "http://localhost:4600",
	webApps: {
		localman: "https://localman.example.org",
		tunelo: "https://tunnel.example.org",
		chat: "https://chat.example.org",
	},
};

/** The primary tenant's account repository on `db` (audit to a silent log). */
export function primaryAccounts(db: Db): AccountRepository {
	return new AccountRepository(
		db,
		PRIMARY_TEST_TENANT,
		new AuditOutbox(db, PRIMARY_TEST_TENANT, createLogger("silent")),
	);
}

/**
 * `primary` (the env tenant of a test IdP), or another tenant served at the
 * same issuer: its own id, domain (resources, web apps) and brand.
 */
export function withTenant(
	primary: Tenant,
	other: Pick<Tenant, "id" | "domain" | "displayName"> | undefined,
): Tenant {
	if (!other) return primary;
	return {
		...primary,
		id: other.id,
		domain: other.domain,
		displayName: other.displayName,
		webApps: webAppsFor(other.domain),
	};
}
