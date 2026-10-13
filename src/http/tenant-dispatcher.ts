import express, {
	type Express,
	type Request,
	type RequestHandler,
} from "express";
import type { TrustProxy } from "../config/trust-proxy.js";
import type { Logger } from "../logger.js";
import { setRequestTenant } from "../tenants/request-tenant.js";
import type { Tenant } from "../tenants/tenant.js";
import { createErrorHandler } from "./error-handler.js";
import {
	RATE_LIMIT_RULES,
	type RateLimitRule,
	rateLimiter,
} from "./security.js";

/** What serves one tenant: its identity and its own Express app. */
export interface ServedTenant {
	readonly tenant: Tenant;
	readonly app: RequestHandler;
}

/** The tenant for a Host, or why there is none. */
export type TenantLookup =
	| { readonly kind: "found"; readonly runtime: ServedTenant }
	| { readonly kind: "unknown" }
	| { readonly kind: "busy" };

export interface DispatcherOptions {
	readonly trustProxy: TrustProxy;
	readonly lookup: (host: string | undefined) => Promise<TenantLookup>;
	readonly logger: Logger;
	readonly rateLimits?: readonly RateLimitRule[];
	/**
	 * Security headers for what the dispatcher answers itself (/healthz,
	 * 421, 503); each tenant's app then sets its own.
	 */
	readonly headers: RequestHandler;
}

const served = new WeakMap<Request, ServedTenant>();

/**
 * The outermost layer, shared by every tenant: trusted proxies, /healthz,
 * the tenant chosen from the Host header (unknown hosts get 421, as
 * discovery URLs follow the Host header), process-wide rate limits keyed by
 * tenant and client IP, then the tenant's own app.
 */
export function createDispatcher(options: DispatcherOptions): Express {
	const app = express();
	app.disable("x-powered-by");
	app.set(
		"trust proxy",
		options.trustProxy === false ? false : [...options.trustProxy],
	);
	app.use(options.headers);
	// Liveness only, on any Host, for container healthchecks.
	app.get("/healthz", (_req, res) => {
		res.status(200).json({ status: "ok" });
	});
	app.use(async (req, res, next) => {
		try {
			const found = await options.lookup(req.headers.host);
			if (found.kind === "found") {
				served.set(req, found.runtime);
				setRequestTenant(req, found.runtime.tenant);
				next();
				return;
			}
			if (found.kind === "busy") {
				res.status(503).set("retry-after", "60").type("text/plain");
				res.send("Service temporarily unavailable");
				return;
			}
			res
				.status(421)
				.type("text/plain")
				.send("Misdirected request: unknown host");
		} catch (error) {
			next(error);
		}
	});
	app.use(rateLimiter(options.rateLimits ?? RATE_LIMIT_RULES));
	app.use((req, res, next) => {
		const runtime = served.get(req);
		if (!runtime) {
			next(new Error("Request reached a tenant app without a tenant"));
			return;
		}
		runtime.app(req, res, next);
	});
	app.use(createErrorHandler(options.logger));
	return app;
}
