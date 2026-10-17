import { randomBytes } from "node:crypto";
import {
	type JWTVerifyGetKey,
	SignJWT,
	createLocalJWKSet,
	importJWK,
	jwtVerify,
} from "jose";
import {
	type UpstreamProvider,
	isUpstreamProvider,
} from "../accounts/user-model.js";
import {
	SIGNING_ALG,
	type SigningJwks,
	primarySigningKey,
} from "../oidc/jwks.js";
import type { TenantDocument } from "./tenant-registry.js";
import { appHostsFor } from "./tenant.js";

/** Media type of an enrollment bundle, so it is never taken for a token. */
export const ENROLLMENT_TYPE = "hoandat-enrollment+jwt";

/** A bundle is redeemed by an install set up the same day. */
export const ENROLLMENT_LIFETIME_SECONDS = 24 * 60 * 60;

/**
 * What a self-hosted install learns from its bundle (ADR 0007): which
 * domain it serves, under which name, and who owns it. Never a secret.
 */
export interface EnrollmentClaims {
	/** The tenant's id in the gateway's registry. */
	readonly tenantId: string;
	readonly domain: string;
	readonly displayName: string;
	readonly owner: {
		readonly provider: UpstreamProvider;
		readonly providerId: string;
	};
}

/** The issuer a self-hosted tenant's install runs at: `https://auth.<d>`. */
export function selfHostedIssuer(domain: string): string {
	return `https://${appHostsFor(domain).auth}`;
}

/**
 * Signs a bundle for an `enrolling` tenant with the gateway's ES256 key:
 * `aud` is the install's issuer, `jti` random, valid for a day. The
 * bundle is spent once the tenant is self-hosted, so no `jti` is stored.
 */
export async function issueEnrollmentBundle(options: {
	readonly issuer: string;
	readonly jwks: SigningJwks;
	readonly tenant: TenantDocument;
	readonly owner: EnrollmentClaims["owner"];
}): Promise<string> {
	const signingKey = primarySigningKey(options.jwks);
	const key = await importJWK({ ...signingKey }, SIGNING_ALG);
	const { tenant } = options;
	return new SignJWT({
		domain: tenant.domain,
		display_name: tenant.displayName,
		owner: {
			provider: options.owner.provider,
			provider_id: options.owner.providerId,
		},
	})
		.setProtectedHeader({
			alg: SIGNING_ALG,
			kid: signingKey.kid,
			typ: ENROLLMENT_TYPE,
		})
		.setIssuer(options.issuer)
		.setAudience(selfHostedIssuer(tenant.domain))
		.setSubject(tenant._id)
		.setJti(randomBytes(16).toString("base64url"))
		.setIssuedAt()
		.setExpirationTime(`${ENROLLMENT_LIFETIME_SECONDS}s`)
		.sign(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Verifies a bundle signed by `issuer` for `audience` (an install's
 * issuer) and reads its claims; undefined when it is forged, expired,
 * meant for another install or malformed.
 */
export async function verifyEnrollmentBundle(
	bundle: string,
	keys: JWTVerifyGetKey,
	expected: { readonly issuer: string; readonly audience?: string },
): Promise<EnrollmentClaims | undefined> {
	try {
		const { payload } = await jwtVerify(bundle, keys, {
			issuer: expected.issuer,
			...(expected.audience ? { audience: expected.audience } : {}),
			algorithms: [SIGNING_ALG],
			typ: ENROLLMENT_TYPE,
			requiredClaims: ["sub", "aud", "exp", "jti"],
		});
		const owner = payload.owner;
		if (
			typeof payload.sub !== "string" ||
			typeof payload.domain !== "string" ||
			typeof payload.display_name !== "string" ||
			!isRecord(owner) ||
			!isUpstreamProvider(owner.provider) ||
			typeof owner.provider_id !== "string" ||
			payload.aud !== selfHostedIssuer(payload.domain)
		) {
			return undefined;
		}
		return {
			tenantId: payload.sub,
			domain: payload.domain,
			displayName: payload.display_name,
			owner: { provider: owner.provider, providerId: owner.provider_id },
		};
	} catch {
		return undefined;
	}
}

/**
 * The gateway's own ES256 keys (public parts only), to verify bundles it
 * issued; older keys stay usable through a rotation like for tokens.
 */
export function localBundleKeys(jwks: SigningJwks): JWTVerifyGetKey {
	return createLocalJWKSet({
		keys: jwks.keys.flatMap((key) =>
			key.kty === "EC"
				? [
						{
							kty: key.kty,
							crv: key.crv,
							x: key.x,
							y: key.y,
							kid: key.kid,
							alg: key.alg,
						},
					]
				: [],
		),
	});
}
