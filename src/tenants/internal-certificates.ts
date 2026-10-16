import express, { Router } from "express";
import type { Db } from "mongodb";
import { routeParam } from "../http/form.js";
import { purgeTenantData } from "./tenant-collections.js";
import type { TenantCertificate, TenantRegistry } from "./tenant-registry.js";
import type { TenantSecrets } from "./tenant-secrets.js";
import { appHostsFor } from "./tenant.js";

const HOUR_MS = 60 * 60 * 1000;
const MAX_BACKOFF_MS = 24 * HOUR_MS;

/** Wait before retrying a failed issuance, so one tenant cannot burn rate limits. */
export function certificateBackoffMs(attempts: number): number {
	return Math.min(HOUR_MS * 2 ** Math.max(attempts - 1, 0), MAX_BACKOFF_MS);
}

/** A failure reason the provisioner reports: short, printable, no secrets. */
function shortReason(value: unknown): string {
	const text = typeof value === "string" ? value : "failed";
	return text.replace(/[^\w .:/-]/g, "").slice(0, 200) || "failed";
}

/**
 * The provisioner's queue. It reads due work (issue or remove a tenant's
 * certificates, with the DNS token sealed for its key only) and reports
 * each outcome; the IdP never runs certbot or touches nginx itself.
 */
export function certificateRouter(
	registry: TenantRegistry,
	secrets: TenantSecrets | undefined,
	db: Db,
): Router {
	const router = Router();
	router.use(express.json({ limit: "4kb" }));

	router.get("/work", async (_req, res, next) => {
		try {
			const due = await registry.listCertificateWork(new Date());
			const work = await Promise.all(
				due.map(async (tenant) => {
					const hosts = appHostsFor(tenant.domain);
					return {
						tenantId: tenant._id,
						domain: tenant.domain,
						action:
							tenant.certificate?.status === "removing" ? "remove" : "issue",
						http01: [hosts.auth, hosts.chat, hosts.localman, hosts.tunnel],
						dns01: [hosts.localmanWildcard, hosts.tunnelWildcard],
						dnsCredential:
							(await secrets?.sealedForProvisioner(tenant._id)) ?? null,
					};
				}),
			);
			res.json({ work });
		} catch (error) {
			next(error);
		}
	});

	router.post("/:tenantId", async (req, res, next) => {
		try {
			const tenant = await registry.findById(routeParam(req, "tenantId"));
			const body: unknown = req.body;
			const outcome =
				typeof body === "object" && body !== null
					? Reflect.get(body, "outcome")
					: undefined;
			if (!tenant?.certificate) {
				res.status(404).json({ error: "no_certificate_work" });
				return;
			}
			const now = new Date();
			const previous = tenant.certificate;
			let certificate: TenantCertificate | undefined;
			if (outcome === "issued" && previous.status === "removing") {
				// Expired or removed while this issuance ran: removal stands.
				certificate = previous;
			} else if (outcome === "issued") {
				certificate = { status: "issued", attempts: 0, issuedAt: now };
			} else if (outcome === "failed") {
				const attempts = previous.attempts + 1;
				certificate = {
					status: previous.status === "removing" ? "removing" : "failed",
					attempts,
					lastAttemptAt: now,
					lastError: shortReason(Reflect.get(Object(body), "error")),
					nextAttemptAt: new Date(
						now.getTime() + certificateBackoffMs(attempts),
					),
				};
			} else if (outcome !== "removed") {
				res
					.status(400)
					.json({ error: "outcome must be issued, failed or removed" });
				return;
			}
			// A tenant that expired before activation has no data: once its
			// certificates are gone, the domain is free again.
			if (
				outcome === "removed" &&
				(await registry.deleteUnactivated(tenant._id))
			) {
				await purgeTenantData(db, tenant._id);
				res.status(204).end();
				return;
			}
			await registry.setCertificate(tenant._id, certificate);
			res.status(204).end();
		} catch (error) {
			next(error);
		}
	});
	return router;
}
