import express, {
	type Express,
	type NextFunction,
	type Request,
	type Response,
} from "express";
import type { Db } from "mongodb";
import { routeParam } from "../http/form.js";
import type { Logger } from "../logger.js";
import type { SigningJwks } from "../oidc/jwks.js";
import { type InternalCredentials, requireRole } from "./internal-auth.js";
import { certificateRouter } from "./internal-certificates.js";
import {
	discoveryOf,
	publicJwks,
	tenantDomainCandidates,
} from "./internal-lookups.js";
import {
	SERVING_STATUSES,
	type TenantDocument,
	type TenantRegistry,
} from "./tenant-registry.js";
import { resourcesFor } from "./tenant-resources.js";
import { tenantFromDocument, tenantSigningKeys } from "./tenant-runtime.js";
import type { TenantSecrets } from "./tenant-secrets.js";
import type { Tenant } from "./tenant.js";

export interface InternalApiDependencies {
	readonly credentials: InternalCredentials;
	readonly db: Db;
	readonly registry: TenantRegistry;
	readonly secrets: TenantSecrets | undefined;
	readonly primary: { readonly tenant: Tenant; readonly jwks: SigningJwks };
	/** Hosts the public listener answers as the primary tenant. */
	readonly primaryHosts: readonly string[];
	/** Base URL of the public listener on loopback (discovery is read there). */
	readonly publicOrigin: string;
	readonly logger: Logger;
}

/** What an app may know about a tenant: nothing secret. */
function summary(tenant: Tenant): object {
	return {
		id: tenant.id,
		domain: tenant.domain,
		displayName: tenant.displayName,
		issuer: tenant.issuer,
		status: tenant.status,
		resources: resourcesFor(tenant.domain),
		webApps: tenant.webApps,
	};
}

/**
 * The internal API, on its own loopback listener (never behind nginx):
 * tenant lookup by Host, each tenant's JWKS and discovery for Localman and
 * Tunelo (so they never trust a tenant's public DNS for keys), and the
 * certificate queue for the provisioner. No route returns a secret.
 */
export function createInternalApi(deps: InternalApiDependencies): Express {
	const app = express();
	app.disable("x-powered-by");
	const apps = requireRole(deps.credentials, ["localman", "tunelo"]);
	const primaryHosts = new Set(deps.primaryHosts.map((h) => h.toLowerCase()));

	async function servingTenant(id: string): Promise<
		| {
				tenant: Tenant;
				jwks: () => Promise<SigningJwks>;
		  }
		| undefined
	> {
		if (id === deps.primary.tenant.id) {
			return {
				tenant: deps.primary.tenant,
				jwks: async () => deps.primary.jwks,
			};
		}
		const document = await deps.registry.findById(id);
		const secrets = deps.secrets;
		if (!document || !secrets || !SERVING_STATUSES.includes(document.status)) {
			return undefined;
		}
		return {
			tenant: tenantFromDocument(document),
			jwks: () => tenantSigningKeys(secrets, document._id),
		};
	}

	async function tenantForHost(host: string): Promise<Tenant | undefined> {
		const primary = deps.primary.tenant;
		if (primaryHosts.has(host.toLowerCase())) return primary;
		for (const domain of tenantDomainCandidates(host)) {
			if (domain === primary.domain) return primary;
			// Nothing at, above or under the primary domain is a registry tenant.
			if (
				domain.endsWith(`.${primary.domain}`) ||
				primary.domain.endsWith(`.${domain}`)
			) {
				continue;
			}
			const document: TenantDocument | undefined =
				await deps.registry.findByDomain(domain);
			if (document && SERVING_STATUSES.includes(document.status)) {
				return tenantFromDocument(document);
			}
		}
		return undefined;
	}

	app.get("/internal/tenants/lookup", apps, async (req: Request, res, next) => {
		try {
			const host = typeof req.query.host === "string" ? req.query.host : "";
			const tenant = await tenantForHost(host);
			if (!tenant) {
				res.status(404).json({ error: "unknown_tenant" });
				return;
			}
			res.json(summary(tenant));
		} catch (error) {
			next(error);
		}
	});

	app.get("/internal/tenants/:id/jwks", apps, async (req, res, next) => {
		try {
			const found = await servingTenant(routeParam(req, "id"));
			if (!found) {
				res.status(404).json({ error: "unknown_tenant" });
				return;
			}
			res.json(publicJwks(await found.jwks()));
		} catch (error) {
			next(error);
		}
	});

	app.get(
		"/internal/tenants/:id/openid-configuration",
		apps,
		async (req, res, next) => {
			try {
				const found = await servingTenant(routeParam(req, "id"));
				if (!found) {
					res.status(404).json({ error: "unknown_tenant" });
					return;
				}
				const discovery = await discoveryOf(
					deps.publicOrigin,
					new URL(found.tenant.issuer),
				);
				res.status(discovery.status).type("json").send(discovery.body);
			} catch (error) {
				next(error);
			}
		},
	);

	app.use(
		"/internal/certificates",
		requireRole(deps.credentials, ["provisioner"]),
		certificateRouter(deps.registry, deps.secrets, deps.db),
	);

	app.use((_req, res) => {
		res.status(404).json({ error: "not_found" });
	});
	// JSON for every failure; logged without request data (bodies may hold
	// provisioner reports, headers carry credentials).
	app.use(
		(error: unknown, _req: Request, res: Response, _next: NextFunction) => {
			const status =
				typeof error === "object" &&
				error !== null &&
				Reflect.get(error, "type") === "entity.parse.failed"
					? 400
					: 500;
			if (status === 500) {
				deps.logger.error(
					{ error: error instanceof Error ? error.name : "error" },
					"Internal API request failed",
				);
			}
			res
				.status(status)
				.json({ error: status === 400 ? "invalid_request" : "server_error" });
		},
	);
	return app;
}
