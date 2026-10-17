import { type Request, type Response, Router } from "express";
import { formRateLimit } from "../http/form.js";
import { pullTokenMatches } from "./pull-tokens.js";
import { RELEASE_IMAGES, type ReleaseUpstream } from "./release-upstream.js";
import type { TenantRegistry } from "./tenant-registry.js";

/**
 * The release registry of self-hosted installs (ADR 0007): the read side
 * of the OCI distribution API for the release images, at /v2 of the
 * primary tenant. A self-hosted tenant signs in with HTTP Basic (its id
 * and the pull token it got when enrolling); manifests and tag lists come
 * from GHCR through the gateway, blobs are a redirect to GHCR's signed
 * CDN URL, so image layers never pass through this server.
 */

const REALM = 'Basic realm="hoandat releases"';
/** A tag, or a digest (manifests are fetched by both). */
const REFERENCE = /^(?:[A-Za-z0-9_][A-Za-z0-9._-]{0,127}|sha256:[a-f0-9]{64})$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
/** Manifests are small; anything larger is not one of ours. */
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
/** A pull asks for a manifest and each layer: allow whole pulls, not floods. */
const PULLS_PER_MINUTE = 600;

function ociError(
	res: Response,
	status: number,
	code: string,
	message: string,
): void {
	res.status(status).json({ errors: [{ code, message }] });
}

/** The tenant id and pull token of a Basic header, if well formed. */
function basicCredentials(
	req: Request,
): { readonly id: string; readonly token: string } | undefined {
	const header = req.get("authorization") ?? "";
	if (!header.startsWith("Basic ")) return undefined;
	const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
	const colon = decoded.indexOf(":");
	if (colon <= 0) return undefined;
	return { id: decoded.slice(0, colon), token: decoded.slice(colon + 1) };
}

export function createReleaseRegistryRouter(
	registry: TenantRegistry,
	upstream: ReleaseUpstream,
): Router {
	const router = Router();
	router.use("/v2", formRateLimit(PULLS_PER_MINUTE));

	// Every /v2 request: a self-hosted tenant's id and current pull token.
	router.use("/v2", (req, res, next) => {
		res.set("docker-distribution-api-version", "registry/2.0");
		const credentials = basicCredentials(req);
		const deny = (): void => {
			res.set("www-authenticate", REALM);
			ociError(res, 401, "UNAUTHORIZED", "authentication required");
		};
		if (!credentials) {
			deny();
			return;
		}
		registry
			.findById(credentials.id)
			.then((tenant) => {
				const allowed =
					tenant?.status === "self_hosted" &&
					pullTokenMatches(tenant.pullTokenHash, credentials.token);
				if (allowed) next();
				else deny();
			})
			.catch(next);
	});

	router.get("/v2/", (_req, res) => {
		res.status(200).json({});
	});

	/** Relays GHCR's answer: status, the headers a client reads, a small body. */
	const relay = async (
		req: Request,
		res: Response,
		image: string,
		path: string,
	): Promise<void> => {
		const method = req.method === "HEAD" ? "HEAD" : "GET";
		const answer = await upstream.request(image, path, {
			method,
			accept: req.get("accept"),
		});
		const location = answer.headers.get("location");
		if (answer.status >= 300 && answer.status < 400 && location) {
			res.redirect(307, location);
			return;
		}
		for (const name of [
			"content-type",
			"docker-content-digest",
			"content-length",
			"etag",
		]) {
			const value = answer.headers.get(name);
			if (value) res.set(name, value);
		}
		const body =
			method === "HEAD" ? undefined : Buffer.from(await answer.arrayBuffer());
		if (body && body.length > MAX_MANIFEST_BYTES) {
			ociError(res, 502, "UNKNOWN", "upstream answer too large");
			return;
		}
		res.status(answer.status).end(body);
	};

	router.get("/v2/:image/tags/list", (req, res, next) => {
		const image = String(req.params.image);
		if (!RELEASE_IMAGES.has(image)) {
			ociError(res, 404, "NAME_UNKNOWN", "repository name not known");
			return;
		}
		upstream
			.request(image, "tags/list", { method: "GET" })
			.then(async (answer) => {
				const body: unknown = answer.ok ? await answer.json() : undefined;
				const tags =
					typeof body === "object" && body !== null
						? Reflect.get(body, "tags")
						: undefined;
				if (!Array.isArray(tags)) {
					ociError(res, 502, "UNKNOWN", "no tag list upstream");
					return;
				}
				res.status(200).json({ name: image, tags });
			})
			.catch(next);
	});

	for (const kind of ["manifests", "blobs"] as const) {
		const handler = (req: Request, res: Response, next: () => void): void => {
			const image = String(req.params.image);
			const reference = String(req.params.reference);
			if (!RELEASE_IMAGES.has(image)) {
				ociError(res, 404, "NAME_UNKNOWN", "repository name not known");
				return;
			}
			const valid = kind === "blobs" ? DIGEST : REFERENCE;
			if (!valid.test(reference)) {
				ociError(
					res,
					400,
					kind === "blobs" ? "DIGEST_INVALID" : "MANIFEST_INVALID",
					"invalid reference",
				);
				return;
			}
			relay(req, res, image, `${kind}/${reference}`).catch(next);
		};
		router.get(`/v2/:image/${kind}/:reference`, handler);
		router.head(`/v2/:image/${kind}/:reference`, handler);
	}

	// Referrers and anything else: not served (clients fall back to tags).
	router.use("/v2", (_req, res) => {
		ociError(res, 404, "UNSUPPORTED", "not served by this registry");
	});
	return router;
}
