import { formValue } from "../http/form.js";
import type { AdminHandler } from "./admin-routes.js";
import type { ScribeAdminView } from "./admin-scribe-section.js";
import {
	removeScribeKey,
	saveScribeKey,
	scribeKeySummaries,
} from "./scribe-key-settings.js";
import { SCRIBE_VENDORS } from "./scribe-vendors.js";
import type { Tenancy } from "./tenancy.js";

/**
 * /admin's Scribe forms (ADR 0012), registered only when SCRIBE_TENANTS is
 * on and Scribe's sealing key is configured: otherwise they do not exist
 * (404) and the section is not shown.
 */
export function addScribeAdminRoutes(
	post: (path: string, handler: AdminHandler) => void,
	tenancy: Tenancy,
): void {
	if (!tenancy.scribe) return;
	for (const vendor of SCRIBE_VENDORS) {
		post(`/scribe/${vendor}`, (req, _res, { tenant }) =>
			saveScribeKey(tenancy, tenant, vendor, formValue(req, "apiKey") ?? ""),
		);
		post(`/scribe/${vendor}/remove`, (_req, _res, { tenant }) =>
			removeScribeKey(tenancy, tenant, vendor),
		);
	}
}

/** The Scribe section's data, or undefined when Scribe is off here. */
export async function scribeAdminView(
	tenancy: Tenancy,
	tenantId: string,
): Promise<ScribeAdminView | undefined> {
	if (!tenancy.scribe) return undefined;
	return {
		keys: await scribeKeySummaries(tenancy, tenantId),
		serviceIp: tenancy.serviceIp,
	};
}
