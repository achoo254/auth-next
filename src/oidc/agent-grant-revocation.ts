import { createHash, timingSafeEqual } from "node:crypto";
import express, { type Request, type Response, Router } from "express";
import { z } from "zod";
import { revokeGrants } from "../account-portal/revoke-access.js";
import type { AppServices } from "../services.js";
import { STATIC_CLIENT_IDS } from "./clients.js";
import { TUNELO_AGENT_CLIENT_ID } from "./resources.js";

/**
 * Chat revokes the `tunelo-agent` grant of a machine its owner removed (or
 * that signed itself out), so the machine cannot refresh its way back: it
 * must sign in again and the owner approve. Chat names the grant by the
 * `grant_id` claim of the machine's access token (`addAgentGrantClaim`).
 * Public path: nginx refuses `/internal/` from the internet, and Chat calls
 * the IdP through its public URL.
 */
export const AGENT_GRANT_REVOKE_PATH = "/api/tunelo-agent/grants/revoke";

/** The only caller: the Chat server, with its own client credentials. */
const CALLER_CLIENT_ID = STATIC_CLIENT_IDS.chatWeb;

const ID = z.string().regex(/^[\w-]{1,128}$/);
const revokeBody = z.object({ sub: ID, grant_id: ID });

const BASIC = /^Basic ([A-Za-z0-9+/]+=*)$/i;

/** RFC 6749 §2.3.1: id and secret are form-urlencoded, then joined by `:`. */
function formDecode(value: string): string | undefined {
	try {
		return decodeURIComponent(value.replace(/\+/g, " "));
	} catch {
		return undefined;
	}
}

function basicCredentials(
	header: string | undefined,
): { readonly id: string; readonly secret: string } | undefined {
	const encoded = header ? BASIC.exec(header)?.[1] : undefined;
	if (!encoded) return undefined;
	const decoded = Buffer.from(encoded, "base64").toString("utf8");
	const colon = decoded.indexOf(":");
	if (colon < 0) return undefined;
	const id = formDecode(decoded.slice(0, colon));
	const secret = formDecode(decoded.slice(colon + 1));
	return id && secret ? { id, secret } : undefined;
}

/** Compares digests so neither length nor content leaks through timing. */
function sameSecret(given: string, expected: string): boolean {
	const digest = (value: string): Buffer =>
		createHash("sha256").update(value).digest();
	return timingSafeEqual(digest(given), digest(expected));
}

async function isChatServer(
	services: AppServices,
	req: Request,
): Promise<boolean> {
	const credentials = basicCredentials(req.get("authorization"));
	if (!credentials || credentials.id !== CALLER_CLIENT_ID) return false;
	const client = await services.provider.Client.find(CALLER_CLIENT_ID);
	const expected = client?.clientSecret;
	return (
		typeof expected === "string" &&
		expected.length > 0 &&
		sameSecret(credentials.secret, expected)
	);
}

function sendError(res: Response, status: number, error: string): void {
	res.status(status).set("cache-control", "no-store").json({ error });
}

/**
 * 204 once the grant is gone, also when it already was (revoked, expired,
 * account deleted), so Chat may retry safely; 404 when the grant lives but
 * is not a `tunelo-agent` grant of `sub`.
 */
export function createAgentGrantRevocationRouter(
	services: AppServices,
): Router {
	const router = Router();
	router.post(
		AGENT_GRANT_REVOKE_PATH,
		async (req, res, next) => {
			try {
				if (await isChatServer(services, req)) {
					next();
					return;
				}
				res.set("www-authenticate", 'Basic realm="tunelo-agent-grants"');
				sendError(res, 401, "invalid_client");
			} catch (error) {
				next(error);
			}
		},
		// Parsed only after the caller is known, and never before oidc-provider.
		express.json({ limit: "2kb" }),
		async (req, res, next) => {
			try {
				const body = revokeBody.safeParse(req.body);
				if (!body.success) {
					sendError(res, 400, "invalid_request");
					return;
				}
				const { sub, grant_id: grantId } = body.data;
				const grant = await services.provider.Grant.find(grantId);
				if (!grant) {
					res.status(204).end();
					return;
				}
				if (
					grant.clientId !== TUNELO_AGENT_CLIENT_ID ||
					grant.accountId !== sub
				) {
					sendError(res, 404, "unknown_grant");
					return;
				}
				const revoked = await revokeGrants(services, sub, [grantId]);
				// No IP or User-Agent: the request is Chat's server, not the owner's.
				if (revoked > 0) {
					await services.audit.record("grant.revoked", sub, {
						count: revoked,
						cause: "machine-removed",
						clientId: TUNELO_AGENT_CLIENT_ID,
					});
				}
				res.status(204).end();
			} catch (error) {
				next(error);
			}
		},
	);
	return router;
}
