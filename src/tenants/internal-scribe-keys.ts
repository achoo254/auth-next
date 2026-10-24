import express, { type RequestHandler, Router } from "express";
import { routeParam } from "../http/form.js";
import type { ServingTenant } from "./internal-lookups.js";
import { isScribeKeyStatus, isScribeVendor } from "./scribe-vendors.js";
import type { TenantSecrets } from "./tenant-secrets.js";

const RECIPIENT = /^[0-9a-f]{16}$/;

/**
 * A tenant's AI keys for Scribe (ADR 0012), for the `scribe` role only.
 * Keys leave sealed to Scribe's own public key, never in plaintext; a
 * tenant that is not served gets 404, one without Scribe on (or with
 * SCRIBE_TENANTS off) no keys. Scribe reports a key it could not use;
 * the report is kept only for the key it opened (same recipient).
 */
export function scribeKeysRouter(
	secrets: TenantSecrets | undefined,
	servingTenant: (id: string) => Promise<ServingTenant | undefined>,
	scribeOnly: RequestHandler,
): Router {
	const router = Router();

	router.get(
		"/internal/tenants/:id/scribe-keys",
		scribeOnly,
		async (req, res, next) => {
			try {
				const found = await servingTenant(routeParam(req, "id"));
				if (!found) {
					res.status(404).json({ error: "unknown_tenant" });
					return;
				}
				if (!secrets || !found.tenant.webApps.scribe) {
					res.json({ keys: [] });
					return;
				}
				const keys = await secrets.sealedForScribe(found.tenant.id);
				res.json({
					keys: keys.map(({ vendor, hint, updatedAt, status, sealed }) => ({
						vendor,
						hint,
						updatedAt,
						...(status ? { status } : {}),
						sealed: {
							kid: sealed.kid,
							iv: sealed.iv,
							ciphertext: sealed.ciphertext,
							tag: sealed.tag,
							wrappedKey: sealed.wrappedKey,
							recipient: sealed.recipient,
						},
					})),
				});
			} catch (error) {
				next(error);
			}
		},
	);

	router.post(
		"/internal/tenants/:id/scribe-keys/:vendor/status",
		scribeOnly,
		express.json({ limit: "1kb" }),
		async (req, res, next) => {
			try {
				const vendor = routeParam(req, "vendor");
				const body: unknown = req.body;
				const status = body && Reflect.get(Object(body), "status");
				const recipient = body && Reflect.get(Object(body), "recipient");
				if (
					!isScribeVendor(vendor) ||
					!isScribeKeyStatus(status) ||
					typeof recipient !== "string" ||
					!RECIPIENT.test(recipient)
				) {
					res.status(400).json({ error: "invalid_request" });
					return;
				}
				const found = await servingTenant(routeParam(req, "id"));
				if (!found) {
					res.status(404).json({ error: "unknown_tenant" });
					return;
				}
				if (secrets && found.tenant.webApps.scribe) {
					await secrets.setScribeStatus(
						found.tenant.id,
						vendor,
						recipient,
						status,
					);
				}
				res.status(204).end();
			} catch (error) {
				next(error);
			}
		},
	);
	return router;
}
