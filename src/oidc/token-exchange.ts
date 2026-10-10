import type {
	AccessToken,
	ClientCredentials,
	JWTStructured,
	KoaContextWithOIDC,
	TokenEndpointGrantContext,
} from "oidc-provider";
import type Provider from "oidc-provider";
import { errors } from "oidc-provider";
import type { AccountStore } from "./claims.js";
import { STATIC_CLIENT_IDS, TOKEN_EXCHANGE_GRANT } from "./clients.js";
import { resourceServerInfo } from "./resources.js";
import {
	ACCESS_TOKEN_TYPE,
	EXCHANGE_PARAMETERS,
	EXCHANGE_REPEATABLE_PARAMETERS,
	EXCHANGE_SCOPE,
	EXCHANGE_TARGET,
	parseExchangeRequest,
} from "./token-exchange-request.js";

/** The only client allowed to exchange its users' tokens. */
const EXCHANGE_CLIENT_ID = STATIC_CLIENT_IDS.localmanWeb;

const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]*$/;

/** What a valid subject token says about whom it was issued for. */
interface Subject {
	readonly accountId: string;
	readonly grantId: string;
}

/**
 * The subject token must be an opaque access token this issuer gave the
 * calling client, unexpired and not revoked (opaque tokens live in MongoDB
 * and die with their grant), whose grant still exists, for an account that
 * is still active. JWT access
 * tokens are refused: they carry no grant, so a revoked one would pass.
 * RFC 8693 §2.2.2: an unacceptable subject token is `invalid_request`.
 */
async function loadSubject(
	provider: Provider,
	accounts: AccountStore,
	clientId: string,
	value: string,
): Promise<Subject> {
	if (JWT_SHAPE.test(value)) {
		throw new errors.InvalidRequest(
			"subject_token must be the opaque access token from the client's sign-in",
		);
	}
	const invalid = new errors.InvalidRequest(
		"subject_token is invalid, expired or revoked",
	);
	const token = await provider.AccessToken.find(value);
	if (!token || token.clientId !== clientId) throw invalid;
	const { accountId, grantId } = token;
	if (!accountId || !grantId) throw invalid;
	const grant = await provider.Grant.find(grantId);
	if (!grant || grant.clientId !== clientId || grant.accountId !== accountId) {
		throw invalid;
	}
	const account = await accounts.findAccount(accountId);
	if (!account) throw invalid;
	return { accountId, grantId };
}

async function exchangeToken(
	ctx: TokenEndpointGrantContext,
	accounts: AccountStore,
): Promise<void> {
	const { client, provider, params } = ctx.oidc;
	// Only localman-web lists the grant, so oidc-provider already refused the
	// others; checked again so a config change cannot widen it silently.
	if (client.clientId !== EXCHANGE_CLIENT_ID) {
		throw new errors.UnauthorizedClient("client may not exchange tokens");
	}
	const request = parseExchangeRequest(params);
	const subject = await loadSubject(
		provider,
		accounts,
		client.clientId,
		request.subjectToken,
	);
	const token = new provider.AccessToken({
		client,
		accountId: subject.accountId,
		grantId: subject.grantId,
		gty: "token_exchange",
		scope: EXCHANGE_SCOPE,
		resourceServer: new provider.ResourceServer(
			EXCHANGE_TARGET,
			resourceServerInfo(EXCHANGE_TARGET),
		),
	});
	const value = await token.save();
	// No refresh token: the client exchanges again with a fresh subject token.
	ctx.body = {
		access_token: value,
		issued_token_type: ACCESS_TOKEN_TYPE,
		token_type: token.tokenType,
		expires_in: token.expiration,
		scope: token.scope,
	};
}

/**
 * `formats.customizers.jwt`: an exchanged token says who acts for the
 * user (RFC 8693 §4.1 `act`) and which client it was issued to (`azp`).
 */
export function addActorClaims(
	ctx: KoaContextWithOIDC | undefined,
	token: AccessToken | ClientCredentials,
	parts: JWTStructured,
): void {
	if (ctx?.oidc?.params?.grant_type !== TOKEN_EXCHANGE_GRANT) return;
	parts.payload.azp = token.clientId;
	parts.payload.act = { sub: token.clientId };
}

const GRANT_NOT_ALLOWED = "requested grant type is not allowed for this client";

function isErrorBody(
	body: unknown,
): body is { error: string; error_description?: string } {
	return (
		typeof body === "object" &&
		body !== null &&
		typeof Reflect.get(body, "error") === "string"
	);
}

/**
 * oidc-provider answers a grant missing from the client's `grant_types`
 * with `invalid_request`; RFC 6749 §5.2 names that `unauthorized_client`.
 */
async function reportUnauthorizedClient(
	ctx: KoaContextWithOIDC,
	next: () => Promise<void>,
): Promise<void> {
	await next();
	const body: unknown = ctx.body;
	if (
		ctx.oidc?.route === "token" &&
		ctx.oidc.params?.grant_type === TOKEN_EXCHANGE_GRANT &&
		isErrorBody(body) &&
		body.error === "invalid_request" &&
		body.error_description === GRANT_NOT_ALLOWED
	) {
		ctx.body = {
			error: "unauthorized_client",
			error_description: "client may not exchange tokens",
		};
	}
}

/** Registers the RFC 8693 grant on the token endpoint. */
export function enableTokenExchange(
	provider: Provider,
	accounts: AccountStore,
): void {
	provider.registerGrantType(
		TOKEN_EXCHANGE_GRANT,
		(ctx) => exchangeToken(ctx, accounts),
		EXCHANGE_PARAMETERS,
		EXCHANGE_REPEATABLE_PARAMETERS,
	);
	provider.use(reportUnauthorizedClient);
}
