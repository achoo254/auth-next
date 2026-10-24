import { hostReachesService } from "./ownership-records.js";
import type { Tenancy } from "./tenancy.js";
import type { TenantDocument } from "./tenant-registry.js";

/** What checking `scribe.<domain>` found; "unknown" proves nothing either way. */
export type ScribeHostCheck = "ok" | "address" | "unknown";

/**
 * Checks that `scribe.<domain>` reaches this service (DNS only, or proxied
 * by Cloudflare like the other hosts) and, once it does, queues its
 * certificate (ADR 0012). A certificate already queued, failing (its
 * backoff stands, so checking again and again never hammers Let's
 * Encrypt) or issued is left as it is. Never part of the ownership check:
 * a missing record only keeps Scribe without a certificate.
 */
export async function checkScribeHost(
	tenancy: Tenancy,
	tenant: TenantDocument,
): Promise<ScribeHostCheck> {
	const serviceIp = tenancy.serviceIp;
	if (!serviceIp) return "unknown";
	const result = await hostReachesService(
		`scribe.${tenant.domain}`,
		serviceIp,
		tenancy.resolver,
	);
	if (result === "ok" && tenant.scribeCertificate === undefined) {
		await tenancy.registry.setScribeCertificate(
			tenant._id,
			{ status: "pending", attempts: 0 },
			true,
		);
	}
	return result;
}
