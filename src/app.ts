import express, { type Express, type RequestHandler } from "express";
import {
	ACCOUNT_API_PATH,
	createAccountApiRouter,
} from "./account-api/account-api-routes.js";
import { createAccountRouter } from "./account-portal/account-routes.js";
import { createAppsRouter } from "./app-directory/apps-page.js";
import { createAssetsRouter } from "./assets.js";
import type { Env } from "./config/env.js";
import { createAasaRouter } from "./http/apple-app-site-association.js";
import { createErrorHandler } from "./http/error-handler.js";
import { createIosCallbackRouter } from "./http/ios-callback-page.js";
import {
	type RateLimitRule,
	forwardTrustedClientInfo,
	nativeRedirectSchemes,
	securityHeaders,
} from "./http/security.js";
import { createDispatcher } from "./http/tenant-dispatcher.js";
import { createLanguageRouter } from "./i18n/language-route.js";
import { createInteractionRouter } from "./interactions/interaction-router.js";
import { createUpstreamCallbackRouter } from "./interactions/upstream-callback.js";
import { createPrivacyRouter } from "./legal/privacy-page.js";
import { INTERACTION_PATH } from "./oidc/provider.js";
import type { AppServices } from "./services.js";
import { createTelegramLinkRouter } from "./telegram/link-routes.js";
import { createTelegramWebhookRouter } from "./telegram/webhook-routes.js";
import { PRIMARY_TENANT_ID } from "./tenants/env-tenant.js";
import { bindRequestTenant } from "./tenants/request-tenant.js";

export interface TenantAppOptions {
	readonly services: AppServices;
	readonly env: Pick<
		Env,
		| "TRUST_PROXY"
		| "CHAT_MOBILE_REDIRECT_URI"
		| "SCRIBE_MOBILE_REDIRECT_URI"
		| "MIU_MOBILE_REDIRECT_URI"
		| "IOS_APP_ID"
	>;
	/**
	 * Replaces the interaction pages under /interaction. Tests only: the
	 * automatic sign-in helper never ships in production wiring.
	 */
	readonly interactions?: RequestHandler;
}

/**
 * The tenant's pages behind the dispatcher: security headers, static
 * assets, the server-rendered pages (the app list at /apps, interactions,
 * /account, Google/GitHub callbacks, Telegram webhook), then the tenant's
 * provider for everything else.
 */
export function createTenantApp(options: TenantAppOptions): Express {
	const { services, env } = options;
	const { tenant } = services;
	const app = express();
	app.disable("x-powered-by");
	// Mounted per request rather than with app.use, so it sets its own proxy
	// trust (req.ip, req.protocol) the same way the dispatcher does.
	app.set(
		"trust proxy",
		env.TRUST_PROXY === false ? false : [...env.TRUST_PROXY],
	);
	app.use(securityHeaders(tenant.issuer, nativeRedirectSchemes(env)));
	app.use(bindRequestTenant(tenant));
	// Interaction handlers call provider.interactionDetails/Finished, which
	// read the same forwarded headers as the provider itself.
	app.use(forwardTrustedClientInfo);
	app.use("/assets", createAssetsRouter());
	app.use(createPrivacyRouter(new URL(tenant.issuer).host));
	app.use(createLanguageRouter(services));
	app.use(createAppsRouter(tenant));
	// The iOS account app (primary tenant only, like its client).
	if (tenant.id === PRIMARY_TENANT_ID) {
		app.use(createAasaRouter(env.IOS_APP_ID));
		app.use(createIosCallbackRouter(new URL(tenant.issuer).host));
		app.use(ACCOUNT_API_PATH, createAccountApiRouter(services));
	}
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

export interface AppOptions extends TenantAppOptions {
	readonly env: Pick<
		Env,
		| "TRUST_PROXY"
		| "ALLOWED_HOSTS"
		| "CHAT_MOBILE_REDIRECT_URI"
		| "SCRIBE_MOBILE_REDIRECT_URI"
		| "MIU_MOBILE_REDIRECT_URI"
		| "IOS_APP_ID"
	>;
	readonly rateLimits?: readonly RateLimitRule[];
}

/**
 * The tenant's app behind the dispatcher, served at its issuer's host and
 * ALLOWED_HOSTS. Tests and the conformance harness use this; the server
 * process builds the same through createServing (server.ts).
 */
export function createApp(options: AppOptions): Express {
	const { services, env } = options;
	const runtime = { tenant: services.tenant, app: createTenantApp(options) };
	const hosts = new Set(
		[new URL(services.tenant.issuer).host, ...env.ALLOWED_HOSTS].map((host) =>
			host.toLowerCase(),
		),
	);
	return createDispatcher({
		trustProxy: env.TRUST_PROXY,
		rateLimits: options.rateLimits,
		logger: services.logger,
		headers: securityHeaders(
			services.tenant.issuer,
			nativeRedirectSchemes(env),
		),
		runtime,
		servesHost: (host) => host !== undefined && hosts.has(host.toLowerCase()),
	});
}
