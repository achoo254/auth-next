import express, { type Express, type RequestHandler } from "express";
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

/** What serves the tenant: its identity and its own Express app. */
export interface ServedTenant {
	readonly tenant: Tenant;
	readonly app: RequestHandler;
}

export interface DispatcherOptions {
	readonly trustProxy: TrustProxy;
	readonly runtime: ServedTenant;
	/** The Host values served: the issuer's host and ALLOWED_HOSTS. */
	readonly servesHost: (host: string | undefined) => boolean;
	readonly logger: Logger;
	readonly rateLimits?: readonly RateLimitRule[];
	/**
	 * Security headers for what the dispatcher answers itself (/healthz,
	 * 421); the tenant's app then sets its own.
	 */
	readonly headers: RequestHandler;
}

/**
 * The outermost layer: trusted proxies, /healthz, the Host check (unknown
 * hosts get 421, as discovery URLs follow the Host header), process-wide
 * rate limits keyed by tenant and client IP, then the tenant's own app.
 */
export function createDispatcher(options: DispatcherOptions): Express {
	const { runtime } = options;
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
	app.use((req, res, next) => {
		if (!options.servesHost(req.headers.host)) {
			res
				.status(421)
				.type("text/plain")
				.send("Misdirected request: unknown host");
			return;
		}
		setRequestTenant(req, runtime.tenant);
		next();
	});
	app.use(rateLimiter(options.rateLimits ?? RATE_LIMIT_RULES));
	app.use((req, res, next) => {
		runtime.app(req, res, next);
	});
	app.use(createErrorHandler(options.logger));
	return app;
}
