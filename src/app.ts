import express, { type Express, type RequestHandler } from "express";
import type Provider from "oidc-provider";
import type { Env } from "./config/env.js";
import { createErrorHandler } from "./http/error-handler.js";
import { interactionPlaceholder } from "./http/interaction-placeholder.js";
import {
	type RateLimitRule,
	applySecurity,
	forwardTrustedClientInfo,
	requireKnownHost,
} from "./http/security.js";
import type { Logger } from "./logger.js";
import { INTERACTION_PATH } from "./oidc/provider.js";

export interface AppOptions {
	readonly provider: Provider;
	readonly logger: Logger;
	readonly env: Pick<Env, "ISSUER" | "TRUST_PROXY" | "ALLOWED_HOSTS">;
	/**
	 * Handles `/interaction/*` (login, consent, device approval). Defaults to
	 * the 501 placeholder until the login UI exists.
	 */
	readonly interactions?: RequestHandler;
	readonly rateLimits?: readonly RateLimitRule[];
}

/** Express shell: security layer, /healthz, interactions, then the provider. */
export function createApp(options: AppOptions): Express {
	const { provider, logger, env } = options;
	const app = express();
	app.disable("x-powered-by");
	applySecurity(app, {
		trustProxy: env.TRUST_PROXY,
		issuer: env.ISSUER,
		rateLimits: options.rateLimits,
	});

	// Liveness only; MongoDB outages surface as provider errors, and the
	// process exits at startup when MongoDB is unreachable.
	app.get("/healthz", (_req, res) => {
		res.status(200).json({ status: "ok" });
	});

	// Everything below serves issuer URLs; /healthz stays reachable on any
	// Host for container healthchecks.
	app.use(requireKnownHost([new URL(env.ISSUER).host, ...env.ALLOWED_HOSTS]));
	// Interaction handlers call provider.interactionDetails/Finished, which
	// read the same forwarded headers as the provider itself.
	app.use(forwardTrustedClientInfo);
	app.use(INTERACTION_PATH, options.interactions ?? interactionPlaceholder);

	const callback = provider.callback();
	app.use((req, res, next) => {
		callback(req, res).catch(next);
	});

	app.use(createErrorHandler(logger));
	return app;
}
