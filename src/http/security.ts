import type { Express, RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import helmet from "helmet";
import type { TrustProxy } from "../config/trust-proxy.js";
import { OIDC_ROUTES } from "../oidc/provider.js";
import { findRequestTenant } from "../tenants/request-tenant.js";
import { normalizeRoutePath } from "./route-path.js";

export interface RateLimitRule {
	readonly name: string;
	/**
	 * Request paths (not prefixes) counted against this rule, matched after
	 * normalizeRoutePath so every spelling the provider routes is counted.
	 */
	readonly paths: readonly string[];
	readonly windowMs: number;
	readonly limit: number;
}

const MINUTE_MS = 60_000;

/**
 * Per-IP budgets for the endpoints worth brute-forcing or flooding. A
 * Tunelo CLI polls /token every 5 s during device login (12 per minute).
 */
export const RATE_LIMIT_RULES: readonly RateLimitRule[] = [
	{ name: "token", paths: [OIDC_ROUTES.token], windowMs: MINUTE_MS, limit: 60 },
	{
		name: "device",
		paths: [OIDC_ROUTES.code_verification, OIDC_ROUTES.device_authorization],
		windowMs: MINUTE_MS,
		limit: 30,
	},
	{
		name: "authorization",
		paths: [
			OIDC_ROUTES.authorization,
			OIDC_ROUTES.pushed_authorization_request,
		],
		windowMs: MINUTE_MS,
		limit: 60,
	},
	{
		name: "registration",
		paths: [OIDC_ROUTES.registration],
		windowMs: 60 * MINUTE_MS,
		limit: 20,
	},
];

export interface SecurityOptions {
	readonly trustProxy: TrustProxy;
	readonly issuer: string;
	readonly rateLimits?: readonly RateLimitRule[];
}

/**
 * CSP for the provider's own pages and the server-rendered forms: no inline
 * script (oidc-provider adds a hash for its form_post page itself), no
 * inline style (every page uses the self-hosted stylesheets), no framing.
 * Images may be https (Google/GitHub avatars). form-action must
 * also allow the redirect chain after a form post (back to https apps,
 * loopback MCP clients and the private-use schemes of native apps), because
 * browsers apply it to redirects too: without the scheme, WebKit drops the
 * redirect to `com.example.app:/auth/callback` after the consent form and
 * the app's sign-in sheet never closes.
 */
function contentSecurityPolicy(
	issuer: string,
	nativeSchemes: readonly string[],
): Parameters<typeof helmet>[0] {
	const https = new URL(issuer).protocol === "https:";
	return {
		contentSecurityPolicy: {
			useDefaults: false,
			directives: {
				defaultSrc: ["'self'"],
				baseUri: ["'self'"],
				// Cloudflare Web Analytics: its beacon script and where it reports.
				scriptSrc: ["'self'", "https://static.cloudflareinsights.com"],
				scriptSrcAttr: ["'none'"],
				styleSrc: ["'self'"],
				imgSrc: ["'self'", "data:", "https:"],
				fontSrc: ["'self'"],
				connectSrc: ["'self'", "https://cloudflareinsights.com"],
				formAction: [
					"'self'",
					"https:",
					"http://localhost:*",
					"http://127.0.0.1:*",
					...nativeSchemes,
				],
				frameAncestors: ["'none'"],
				objectSrc: ["'none'"],
				upgradeInsecureRequests: https ? [] : null,
			},
		},
	};
}

/**
 * One store per rule for the whole process, keyed by (tenant, client IP):
 * each tenant has its own budget, and touching other tenants never resets
 * or shares one. Requests before tenant selection count under no tenant.
 */
export function rateLimiter(rules: readonly RateLimitRule[]): RequestHandler {
	const limiters = new Map<string, RequestHandler>();
	for (const rule of rules) {
		const limiter = rateLimit({
			windowMs: rule.windowMs,
			limit: rule.limit,
			keyGenerator: (req) =>
				`${findRequestTenant(req)?.id ?? ""}|${ipKeyGenerator(req.ip ?? "")}`,
			standardHeaders: "draft-8",
			legacyHeaders: false,
			message: {
				error: "too_many_requests",
				error_description: "Too many requests; retry later",
			},
		});
		for (const path of rule.paths) {
			limiters.set(normalizeRoutePath(path), limiter);
		}
	}
	return (req, res, next) => {
		const limiter = limiters.get(normalizeRoutePath(req.path));
		if (limiter) {
			limiter(req, res, next);
			return;
		}
		next();
	};
}

/**
 * Trust proxy, security headers and rate limits. Express resolves the client
 * IP and protocol only through the proxies listed in TRUST_PROXY; anything
 * else in X-Forwarded-* is ignored.
 */
export function applySecurity(app: Express, options: SecurityOptions): void {
	app.set(
		"trust proxy",
		options.trustProxy === false ? false : [...options.trustProxy],
	);
	app.use(securityHeaders(options.issuer));
	app.use(rateLimiter(options.rateLimits ?? RATE_LIMIT_RULES));
}

/**
 * CSP scheme sources (`com.example.app:`) of the native apps' configured
 * private-use redirect URIs.
 */
export function nativeRedirectSchemes(env: {
	readonly CHAT_MOBILE_REDIRECT_URI: string;
	readonly SCRIBE_MOBILE_REDIRECT_URI: string;
	readonly MIU_MOBILE_REDIRECT_URI: string;
}): string[] {
	const schemes = [
		env.CHAT_MOBILE_REDIRECT_URI,
		env.SCRIBE_MOBILE_REDIRECT_URI,
		env.MIU_MOBILE_REDIRECT_URI,
	]
		.map((uri) => URL.parse(uri)?.protocol)
		.filter((scheme): scheme is string => scheme !== undefined);
	return [...new Set(schemes)];
}

/** Security headers (CSP, framing, HSTS...) of the pages served at `issuer`. */
export function securityHeaders(
	issuer: string,
	nativeSchemes: readonly string[] = [],
): RequestHandler {
	return helmet(contentSecurityPolicy(issuer, nativeSchemes));
}

/**
 * Hands oidc-provider (a Koa app with `proxy = true`) only what Express
 * already validated: the protocol and client IP from trusted proxies. The
 * forwarded host is dropped so discovery URLs follow the real Host header.
 */
export const forwardTrustedClientInfo: RequestHandler = (req, _res, next) => {
	const protocol = req.protocol;
	const ip = req.ip ?? req.socket.remoteAddress ?? "";
	req.headers["x-forwarded-proto"] = protocol;
	req.headers["x-forwarded-for"] = ip;
	req.headers["x-forwarded-host"] = undefined;
	next();
};

/**
 * Answers 421 Misdirected Request unless the Host header is the issuer's
 * host or one of the extra hosts allowed in configuration. Endpoint URLs in
 * discovery follow the Host header, so other hosts must never be served.
 */
export function requireKnownHost(
	allowedHosts: readonly string[],
): RequestHandler {
	const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));
	return (req, res, next) => {
		const host = req.headers.host?.toLowerCase();
		if (host && allowed.has(host)) {
			next();
			return;
		}
		res
			.status(421)
			.type("text/plain")
			.send("Misdirected request: unknown host");
	};
}
