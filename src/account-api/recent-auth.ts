import type { RequestHandler } from "express";
import {
	type JSONWebKeySet,
	type JWTVerifyGetKey,
	createLocalJWKSet,
	jwtVerify,
} from "jose";
import { RECENT_LOGIN_SECONDS } from "../account-portal/portal-session.js";
import { ACCOUNT_IOS_CLIENT_ID } from "../oidc/account-ios-client.js";
import {
	RSA_ID_TOKEN_ALG,
	SIGNING_ALG,
	type SigningJwks,
} from "../oidc/jwks.js";
import type { AppServices } from "../services.js";
import { apiContextOf, sendApiError } from "./bearer-auth.js";

/** A future `auth_time` is accepted up to this clock skew. */
const CLOCK_SKEW_SECONDS = 60;

/** The public half of the tenant's signing keys, for its own ID tokens. */
export function idTokenVerificationKeys(jwks: SigningJwks): JWTVerifyGetKey {
	const set: JSONWebKeySet = {
		keys: jwks.keys.map((key) =>
			key.kty === "EC"
				? {
						kty: key.kty,
						crv: key.crv,
						x: key.x,
						y: key.y,
						kid: key.kid,
						alg: key.alg,
						use: key.use,
					}
				: {
						kty: key.kty,
						n: key.n,
						e: key.e,
						kid: key.kid,
						alg: key.alg,
						use: key.use,
					},
		),
	};
	return createLocalJWKSet(set);
}

function epochNow(): number {
	return Math.floor(Date.now() / 1000);
}

/**
 * The API's "signed in within 10 minutes" (the web's `recentLogin`): an ID
 * token this issuer signed for `account-ios`, for this account, whose
 * `auth_time` is at most 10 minutes old. The app gets one from a
 * `prompt=login` authorization. Each ID token works once.
 */
export async function isRecentAuth(
	services: AppServices,
	idToken: unknown,
	accountId: string,
): Promise<boolean> {
	if (typeof idToken !== "string" || idToken.length > 8192) return false;
	let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
	try {
		({ payload } = await jwtVerify(idToken, services.idTokenKeys, {
			issuer: services.issuer,
			audience: ACCOUNT_IOS_CLIENT_ID,
			algorithms: [SIGNING_ALG, RSA_ID_TOKEN_ALG],
		}));
	} catch {
		return false;
	}
	const authTime: unknown = payload.auth_time;
	const now = epochNow();
	if (
		payload.sub !== accountId ||
		typeof authTime !== "number" ||
		now - authTime > RECENT_LOGIN_SECONDS ||
		authTime > now + CLOCK_SKEW_SECONDS
	) {
		return false;
	}
	// Kept until the ID token expires; past that, jwtVerify refuses it.
	const ttl = Math.max(60, (payload.exp ?? now) - now + CLOCK_SKEW_SECONDS);
	return services.tokens.claim("reauth-id-token", idToken, { accountId }, ttl);
}

/**
 * Guard of the sensitive routes: the JSON body's `id_token` must prove a
 * recent sign-in (`isRecentAuth`), else 403 `reauth_required`. Runs after
 * `requireBearer`, so it knows the account.
 */
export function requireRecentAuth(services: AppServices): RequestHandler {
	return (req, res, next) => {
		const api = apiContextOf(req);
		const body: unknown = req.body;
		const idToken =
			typeof body === "object" && body !== null
				? Reflect.get(body, "id_token")
				: undefined;
		if (!api) {
			next(new Error("requireRecentAuth before requireBearer"));
			return;
		}
		isRecentAuth(services, idToken, api.account._id)
			.then((recent) => {
				if (recent) {
					next();
					return;
				}
				sendApiError(
					res,
					403,
					"reauth_required",
					"Sign in again (prompt=login) and send the new id_token",
				);
			})
			.catch(next);
	};
}
