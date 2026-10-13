import type { IncomingMessage } from "node:http";
import type { RequestHandler } from "express";
import type { Tenant } from "./tenant.js";

/**
 * The tenant serving each request. Keyed by the Node request object, which
 * Express and oidc-provider's Koa context (`ctx.req`) share, so pages
 * rendered by either find the same tenant.
 */
const tenants = new WeakMap<IncomingMessage, Tenant>();

/** Marks every request through this handler as served by `tenant`. */
export function bindRequestTenant(tenant: Tenant): RequestHandler {
	return (req, _res, next) => {
		tenants.set(req, tenant);
		next();
	};
}

/** The tenant of a request, if one was selected for it yet. */
export function findRequestTenant(req: IncomingMessage): Tenant | undefined {
	return tenants.get(req);
}

/** Marks one request as served by `tenant`. */
export function setRequestTenant(req: IncomingMessage, tenant: Tenant): void {
	tenants.set(req, tenant);
}

/**
 * The tenant of a request. Every route that renders a page sits behind
 * `bindRequestTenant`, so a missing tenant is a wiring bug, not a fallback
 * to some default brand.
 */
export function requestTenant(req: IncomingMessage): Tenant {
	const tenant = tenants.get(req);
	if (!tenant) throw new Error("Request reached a page without a tenant");
	return tenant;
}
