import express, { type Express, type RequestHandler } from "express";
import { createAccountRouter } from "./account-portal/account-routes.js";
import { createAppsRouter } from "./app-directory/apps-page.js";
import { createAssetsRouter } from "./assets.js";
import type { Env } from "./config/env.js";
import { offerDomainGuide } from "./guide/domain-guide-link.js";
import { createDomainGuideRouter } from "./guide/domain-guide-page.js";
import { createErrorHandler } from "./http/error-handler.js";
import {
	type RateLimitRule,
	forwardTrustedClientInfo,
	nativeRedirectSchemes,
	securityHeaders,
} from "./http/security.js";
import { createDispatcher } from "./http/tenant-dispatcher.js";
import { createLanguageRouter } from "./i18n/language-route.js";
import { createInteractionRouter } from "./interactions/interaction-router.js";
import { createUpstreamCallbackRouter } from "./interactions/upstream-start.js";
import { createPrivacyRouter } from "./legal/privacy-page.js";
import { INTERACTION_PATH } from "./oidc/provider.js";
import type { AppServices } from "./services.js";
import { createTelegramLinkRouter } from "./telegram/link-routes.js";
import { createTelegramWebhookRouter } from "./telegram/webhook-routes.js";
import { inactiveTenant } from "./tenants/admin-gate-pages.js";
import { createAdminRouter } from "./tenants/admin-routes.js";
import { CLAIM_PATH, createClaimRouter } from "./tenants/claim-routes.js";
import { createEnrollmentRouter } from "./tenants/enrollment-routes.js";
import { PRIMARY_TENANT_ID } from "./tenants/env-tenant.js";
import { createMigrationRouter } from "./tenants/migration-routes.js";
import { bindRequestTenant } from "./tenants/request-tenant.js";

export interface TenantAppOptions {
	readonly services: AppServices;
	readonly env: Pick<
		Env,
		"TRUST_PROXY" | "CHAT_MOBILE_REDIRECT_URI" | "SCRIBE_MOBILE_REDIRECT_URI"
	>;
	/**
	 * Replaces the interaction pages under /interaction. Tests only: the
	 * automatic sign-in helper never ships in production wiring.
	 */
	readonly interactions?: RequestHandler;
	/** A self-hosted install waiting to enroll answers its gateway here (ADR 0007). */
	readonly enrollmentChallenge?: RequestHandler;
}

/**
 * One tenant's pages behind the dispatcher: security headers, static
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
	const { tenancy } = services;
	if (tenancy && tenant.id === PRIMARY_TENANT_ID) {
		app.use(offerDomainGuide);
		app.use(createClaimRouter(services, tenancy));
		app.use(createEnrollmentRouter(services, tenancy));
		app.use(createMigrationRouter(services, tenancy));
		app.use(createDomainGuideRouter(new URL(tenant.issuer).host, CLAIM_PATH));
	}
	if (tenancy && tenant.id !== PRIMARY_TENANT_ID) {
		app.use(createAdminRouter(services, tenancy));
	}
	if (options.enrollmentChallenge) app.use(options.enrollmentChallenge);
	app.use(createPrivacyRouter(new URL(tenant.issuer).host));
	app.use(createLanguageRouter(services));
	// Until its owner adds a sign-in provider, a claimed tenant serves only
	// /admin, its assets, the language switch and the privacy page: no
	// sign-in page, no provider endpoint.
	if (
		tenancy &&
		tenant.id !== PRIMARY_TENANT_ID &&
		tenant.status !== "active"
	) {
		app.use(inactiveTenant(tenant));
	}
	app.use(createAppsRouter(tenant));
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
	>;
	readonly rateLimits?: readonly RateLimitRule[];
}

/**
 * A server for one tenant only: the dispatcher serves it at its issuer's
 * host and ALLOWED_HOSTS. Tests and the conformance harness use this; the
 * server process dispatches across every tenant (server.ts).
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
		lookup: async (host) =>
			host && hosts.has(host.toLowerCase())
				? { kind: "found", runtime }
				: { kind: "unknown" },
	});
}
