import type { Request, RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { findRequestTenant } from "../tenants/request-tenant.js";
import { apiContextOf } from "./bearer-auth.js";

/** Requests per minute allowed on /api/account. */
export interface AccountApiLimits {
	/** Every request from one client IP, before the token is checked. */
	readonly perIp: number;
	/** Every request of one account, once its token is checked. */
	readonly perAccount: number;
	/** Re-authenticated actions and link starts of one account. */
	readonly sensitivePerAccount: number;
}

export const DEFAULT_ACCOUNT_API_LIMITS: AccountApiLimits = {
	perIp: 120,
	perAccount: 60,
	sensitivePerAccount: 10,
};

const MINUTE_MS = 60_000;

function tenantKey(req: Request): string {
	return findRequestTenant(req)?.id ?? "";
}

function limiter(limit: number, key: (req: Request) => string): RequestHandler {
	return rateLimit({
		windowMs: MINUTE_MS,
		limit,
		keyGenerator: key,
		standardHeaders: "draft-8",
		legacyHeaders: false,
		message: {
			error: "rate_limited",
			error_description: "Too many requests; retry later",
		},
		// The trusted client IP is already resolved (forwardTrustedClientInfo).
		validate: { xForwardedForHeader: false },
	});
}

/** One budget per (tenant, client IP) for the whole prefix, parameters or not. */
export function ipLimit(limits: AccountApiLimits): RequestHandler {
	return limiter(
		limits.perIp,
		(req) => `${tenantKey(req)}|${ipKeyGenerator(req.ip ?? "")}`,
	);
}

/**
 * One budget per (tenant, account) after bearer-auth, whatever the IP: a
 * stolen token used from many addresses still shares it. Each call makes
 * its own store, so `perAccount` and `sensitivePerAccount` count apart.
 */
export function accountLimit(limit: number): RequestHandler {
	return limiter(
		limit,
		(req) => `${tenantKey(req)}|${apiContextOf(req)?.account._id ?? ""}`,
	);
}
