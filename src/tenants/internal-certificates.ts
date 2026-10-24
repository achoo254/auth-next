import express, { Router } from "express";
import type { Db } from "mongodb";
import { routeParam } from "../http/form.js";
import { purgeTenantData } from "./tenant-collections.js";
import {
	SERVING_STATUSES,
	type TenantCertificate,
	type TenantDocument,
	type TenantRegistry,
	certificateDue,
} from "./tenant-registry.js";
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
 * Which certificate a unit of work is about: the tenant's hosts (and
 * wildcard) certificates, or the separate `scribe.<d>` lineage (ADR 0012).
 */
export type CertificateKind = "hosts" | "scribe";

function actionOf(certificate: TenantCertificate | undefined) {
	return certificate?.status === "removing" ? "remove" : "issue";
}

/** The due work of one tenant, hosts first. */
async function workOf(
	tenant: TenantDocument,
	secrets: TenantSecrets | undefined,
	now: Date,
): Promise<object[]> {
	const hosts = appHostsFor(tenant.domain);
	const dnsCredential =
		(await secrets?.sealedForProvisioner(tenant._id)) ?? null;
	const common = { tenantId: tenant._id, domain: tenant.domain, dnsCredential };
	const work: object[] = [];
	if (certificateDue(tenant.certificate, now)) {
		work.push({
			...common,
			kind: "hosts",
			action: actionOf(tenant.certificate),
			http01: [hosts.auth, hosts.chat, hosts.localman, hosts.tunnel],
			dns01: [hosts.localmanWildcard, hosts.tunnelWildcard],
		});
	}
	const serving = SERVING_STATUSES.includes(tenant.status);
	if (serving && certificateDue(tenant.scribeCertificate, now)) {
		const host = `scribe.${tenant.domain}`;
		work.push({
			...common,
			kind: "scribe",
			action: actionOf(tenant.scribeCertificate),
			certName: host,
			http01: [host],
			dns01: [],
		});
	}
	return work;
}

/**
 * The certificate after the provisioner's report; undefined once removed,
 * "invalid" for an unknown outcome.
 */
function reported(
	previous: TenantCertificate,
	body: unknown,
	now: Date,
): TenantCertificate | undefined | "invalid" {
	const outcome = Reflect.get(Object(body), "outcome");
	if (outcome === "removed") return undefined;
	// Expired or removed while this issuance ran: removal stands.
	if (outcome === "issued" && previous.status === "removing") return previous;
	if (outcome === "issued") {
		return { status: "issued", attempts: 0, issuedAt: now };
	}
	if (outcome !== "failed") return "invalid";
	const attempts = previous.attempts + 1;
	return {
		status: previous.status === "removing" ? "removing" : "failed",
		attempts,
		lastAttemptAt: now,
		lastError: shortReason(Reflect.get(Object(body), "error")),
		nextAttemptAt: new Date(now.getTime() + certificateBackoffMs(attempts)),
	};
}

/**
 * The provisioner's queue. It reads due work (issue or remove a tenant's
 * certificates, with the DNS token sealed for its key only) and reports
 * each outcome; the IdP never runs certbot or touches nginx itself. A
 * report names its work with `?kind=scribe`; without it, it is about the
 * hosts certificates (what provisioners before Scribe send).
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
			const now = new Date();
			const due = await registry.listCertificateWork(now);
			const work = await Promise.all(
				due.map((tenant) => workOf(tenant, secrets, now)),
			);
			res.json({ work: work.flat() });
		} catch (error) {
			next(error);
		}
	});

	router.post("/:tenantId", async (req, res, next) => {
		try {
			const kind: CertificateKind =
				req.query.kind === "scribe" ? "scribe" : "hosts";
			const tenant = await registry.findById(routeParam(req, "tenantId"));
			const previous =
				kind === "scribe" ? tenant?.scribeCertificate : tenant?.certificate;
			if (!tenant || !previous) {
				res.status(404).json({ error: "no_certificate_work" });
				return;
			}
			const certificate = reported(previous, req.body, new Date());
			if (certificate === "invalid") {
				res
					.status(400)
					.json({ error: "outcome must be issued, failed or removed" });
				return;
			}
			if (kind === "scribe") {
				await registry.setScribeCertificate(tenant._id, certificate);
				res.status(204).end();
				return;
			}
			// A tenant that expired before activation has no data: once its
			// certificates are gone, the domain is free again.
			if (!certificate && (await registry.deleteUnactivated(tenant._id))) {
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
