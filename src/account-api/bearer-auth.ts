import type { Request, RequestHandler, Response } from "express";
import type { AccountDocument } from "../accounts/user-model.js";
import { ACCOUNT_IOS_CLIENT_ID } from "../oidc/account-ios-client.js";
import { ACCOUNT_SCOPE } from "../oidc/resources.js";
import type { AppServices } from "../services.js";

/** Who calls /api/account: the account, and the app grant of its token. */
export interface ApiContext {
	readonly account: AccountDocument;
	/** The grant of the access token: the app on this phone. */
	readonly grantId: string;
}

const contexts = new WeakMap<Request, ApiContext>();

export function apiContextOf(req: Request): ApiContext | undefined {
	return contexts.get(req);
}

/** RFC 6750 §2.1 credentials: `Bearer <b64token>`. */
const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i;
const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]*$/;

/** The JSON error body every /api/account failure uses. */
export function sendApiError(
	res: Response,
	status: number,
	error: string,
	description?: string,
): void {
	res
		.status(status)
		.set("cache-control", "no-store")
		.json(description ? { error, error_description: description } : { error });
}

type AuthFailure = "missing" | "invalid" | "insufficient_scope";

/**
 * The checks of token exchange's subject token (token-exchange.ts), for the
 * iOS account app: an opaque access token this tenant issued (JWTs are
 * refused, they outlive their grant), unexpired and not revoked, of
 * `account-ios` with scope `account`, whose grant still exists for the
 * same client and account, for an account that is still active.
 */
async function authenticate(
	services: AppServices,
	header: string | undefined,
): Promise<ApiContext | AuthFailure> {
	const value = header ? BEARER.exec(header)?.[1] : undefined;
	if (!value) return "missing";
	if (JWT_SHAPE.test(value)) return "invalid";
	const token = await services.provider.AccessToken.find(value);
	if (!token) return "invalid";
	if (
		token.clientId !== ACCOUNT_IOS_CLIENT_ID ||
		!token.scopes.has(ACCOUNT_SCOPE)
	) {
		return "insufficient_scope";
	}
	const { accountId, grantId } = token;
	if (!accountId || !grantId) return "invalid";
	const grant = await services.provider.Grant.find(grantId);
	if (
		!grant ||
		grant.clientId !== ACCOUNT_IOS_CLIENT_ID ||
		grant.accountId !== accountId
	) {
		return "invalid";
	}
	const account = await services.accounts.findActiveById(accountId);
	return account ? { account, grantId } : "invalid";
}

/**
 * Lets a request through only with a valid bearer token (see
 * `authenticate`); answers 401/403 with RFC 6750 `WWW-Authenticate`. No
 * cookie or CSRF: the token is the only credential. The header is never
 * logged (pino redacts `authorization`).
 */
export function requireBearer(services: AppServices): RequestHandler {
	return (req, res, next) => {
		authenticate(services, req.get("authorization"))
			.then((result) => {
				if (typeof result !== "string") {
					contexts.set(req, result);
					next();
					return;
				}
				if (result === "missing") {
					res.set("www-authenticate", 'Bearer realm="account"');
					sendApiError(res, 401, "invalid_token", "Bearer token required");
					return;
				}
				if (result === "insufficient_scope") {
					res.set(
						"www-authenticate",
						`Bearer realm="account", error="insufficient_scope", scope="${ACCOUNT_SCOPE}"`,
					);
					sendApiError(res, 403, "insufficient_scope");
					return;
				}
				res.set(
					"www-authenticate",
					'Bearer realm="account", error="invalid_token"',
				);
				sendApiError(
					res,
					401,
					"invalid_token",
					"The access token is invalid, expired or revoked",
				);
			})
			.catch(next);
	};
}

export type ApiHandler = (
	req: Request,
	res: Response,
	api: ApiContext,
) => Promise<void>;

/** A route behind `requireBearer`: the handler gets the caller. */
export function apiRoute(handler: ApiHandler): RequestHandler {
	return (req, res, next) => {
		const api = contexts.get(req);
		if (!api) {
			next(new Error("/api/account route reached without requireBearer"));
			return;
		}
		handler(req, res, api).catch(next);
	};
}
