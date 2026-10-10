import express, { type Express, type RequestHandler } from "express";
import { createAccountRouter } from "./account-portal/account-routes.js";
import { createAssetsRouter } from "./assets.js";
import type { Env } from "./config/env.js";
import { createErrorHandler } from "./http/error-handler.js";
import {
	type RateLimitRule,
	applySecurity,
	forwardTrustedClientInfo,
	requireKnownHost,
} from "./http/security.js";
import { createInteractionRouter } from "./interactions/interaction-router.js";
import { createUpstreamCallbackRouter } from "./interactions/upstream-start.js";
import { createPrivacyRouter } from "./legal/privacy-page.js";
import { INTERACTION_PATH } from "./oidc/provider.js";
import type { AppServices } from "./services.js";
import { createTelegramLinkRouter } from "./telegram/link-routes.js";
import { createTelegramWebhookRouter } from "./telegram/webhook-routes.js";

export interface AppOptions {
	readonly services: AppServices;
	readonly env: Pick<Env, "ISSUER" | "TRUST_PROXY" | "ALLOWED_HOSTS">;
	/**
	 * Replaces the interaction pages under /interaction. Tests only: the
	 * automatic sign-in helper never ships in production wiring.
	 */
	readonly interactions?: RequestHandler;
	readonly rateLimits?: readonly RateLimitRule[];
}

/**
 * Express shell: security layer, /healthz, static assets, the
 * server-rendered pages (interactions, /account, Google/GitHub callbacks,
 * Telegram webhook), then the provider for everything else.
 */
export function createApp(options: AppOptions): Express {
	const { services, env } = options;
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
	app.use("/assets", createAssetsRouter());
	app.use(createPrivacyRouter(new URL(env.ISSUER).host));
	app.use(
		INTERACTION_PATH,
		options.interactions ?? createInteractionRouter(services),
	);
	app.use("/oauth", createUpstreamCallbackRouter(services));
	app.use("/account/telegram", createTelegramLinkRouter(services));
	app.use("/account", createAccountRouter(services));
	app.use(createTelegramWebhookRouter(services));

	const callback = services.provider.callback();
	app.use((req, res, next) => {
		callback(req, res).catch(next);
	});

	app.use(createErrorHandler(services.logger));
	return app;
}
