import { readFile, writeFile } from "node:fs/promises";
import { Router } from "express";
import {
	type JWK,
	type JWTVerifyGetKey,
	createRemoteJWKSet,
	exportJWK,
	generateKeyPair,
} from "jose";
import type { Logger } from "../logger.js";
import { SIGNING_ALG } from "../oidc/jwks.js";
import { OIDC_ROUTES } from "../oidc/provider.js";
import {
	type EnrollmentClaims,
	verifyEnrollmentBundle,
} from "./enrollment-bundle.js";
import {
	ENROLLMENT_CHALLENGE_PATH,
	signChallenge,
} from "./enrollment-challenge.js";
import { ENROLLMENT_REDEEM_PATH } from "./enrollment-routes.js";
/** Retries while the gateway cannot conclude (DNS, challenge not reachable yet). */
const RETRY_MS = 60_000;
/** Answers that will never change by retrying with the same bundle and key. */
const FINAL_ERRORS: ReadonlySet<string> = new Set([
	"invalid-bundle",
	"invalid-key",
	"not-enrolling",
]);
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;

/** The gateway refused for good: retrying the same bundle cannot help. */
class EnrollmentRefused extends Error {}

/** A private P-256 JWK as this module writes it. */
function isPrivateEcKey(value: unknown): value is JWK {
	if (typeof value !== "object" || value === null) return false;
	const { kty, crv, x, y, d } = value as Record<string, unknown>;
	return (
		kty === "EC" &&
		crv === "P-256" &&
		[x, y, d].every((part) => typeof part === "string")
	);
}

export interface InstallEnrollmentOptions {
	/** The gateway's issuer (ENROLLMENT_GATEWAY), without a trailing slash. */
	readonly gateway: string;
	readonly bundlePath: string;
	readonly keyPath: string;
	/** This install's issuer and domain: the bundle must be for them. */
	readonly issuer: string;
	readonly domain: string;
	readonly logger: Logger;
	readonly fetch?: typeof fetch;
	/** The gateway's signing keys; default its published JWKS. */
	readonly gatewayKeys?: JWTVerifyGetKey;
	/** Called once the gateway confirmed the enrollment. */
	readonly onEnrolled?: () => Promise<void>;
}

export interface InstallEnrollment {
	readonly claims: EnrollmentClaims;
	/** Serves the challenge until the install has enrolled. */
	readonly router: Router;
	/** Redeems now and retries while the gateway cannot conclude. */
	start(): void;
	stop(): void;
	/** One redemption attempt; true once enrolled (tests drive it directly). */
	redeem(): Promise<boolean>;
}

/**
 * The install's enrollment key, created on first start (mode 600) and kept
 * so a restart redeems with the same key, which the gateway recognises.
 */
async function loadOrCreateKey(path: string): Promise<JWK> {
	let text: string | undefined;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (!(error instanceof Error) || Reflect.get(error, "code") !== "ENOENT") {
			throw error;
		}
	}
	if (text !== undefined) {
		const stored: unknown = JSON.parse(text);
		if (!isPrivateEcKey(stored)) {
			throw new Error("ENROLLMENT_KEY_PATH holds no P-256 private key");
		}
		return stored;
	}
	const { privateKey } = await generateKeyPair(SIGNING_ALG, {
		extractable: true,
	});
	const jwk = await exportJWK(privateKey);
	await writeFile(path, JSON.stringify(jwk), { mode: 0o600, flag: "wx" });
	return jwk;
}

/**
 * The install side of ADR 0007: checks the bundle is the gateway's and for
 * this install, answers the gateway's challenge, and redeems the bundle.
 * Throws at start-up when the bundle is not valid for this install, so a
 * wrong file never leaves the install waiting forever. Never logs the
 * bundle, the key or a nonce.
 */
export async function createInstallEnrollment(
	options: InstallEnrollmentOptions,
): Promise<InstallEnrollment> {
	const { logger } = options;
	const doFetch = options.fetch ?? fetch;
	const bundle = (await readFile(options.bundlePath, "utf8")).trim();
	const keys =
		options.gatewayKeys ??
		createRemoteJWKSet(new URL(OIDC_ROUTES.jwks, `${options.gateway}/`));
	const claims = await verifyEnrollmentBundle(bundle, keys, {
		issuer: options.gateway,
		audience: options.issuer,
	});
	if (!claims || claims.domain !== options.domain) {
		throw new Error(
			"ENROLLMENT_BUNDLE_PATH holds no valid bundle from ENROLLMENT_GATEWAY for this domain",
		);
	}
	const privateKey = await loadOrCreateKey(options.keyPath);
	const { kty, crv, x, y } = privateKey;
	const publicKey = { kty, crv, x, y };
	let enrolled = false;
	let timer: NodeJS.Timeout | undefined;

	const router = Router();
	router.get(ENROLLMENT_CHALLENGE_PATH, (req, res, next) => {
		const nonce = req.query.nonce;
		if (enrolled || typeof nonce !== "string" || !NONCE.test(nonce)) {
			res.status(404).end();
			return;
		}
		signChallenge(privateKey, nonce, options.gateway)
			.then((answer) => {
				res
					.status(200)
					.set("cache-control", "no-store")
					.type("application/jwt")
					.send(answer);
			})
			.catch(next);
	});

	const redeem = async (): Promise<boolean> => {
		const response = await doFetch(
			`${options.gateway}${ENROLLMENT_REDEEM_PATH}`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ bundle, install_key: publicKey }),
			},
		);
		if (response.ok) {
			enrolled = true;
			await options.onEnrolled?.();
			logger.info({ domain: options.domain }, "Enrolled at the gateway");
			return true;
		}
		const body: unknown = await response.json().catch(() => undefined);
		const error =
			typeof body === "object" && body !== null
				? String(Reflect.get(body, "error"))
				: "unknown";
		if (FINAL_ERRORS.has(error)) {
			logger.error({ error }, "The gateway refused the enrollment bundle");
			throw new EnrollmentRefused(error);
		}
		logger.warn({ error }, "Enrollment not concluded; retrying");
		return false;
	};

	const attempt = (): void => {
		redeem()
			.then((done) => {
				if (!done) timer = setTimeout(attempt, RETRY_MS).unref();
			})
			.catch((error: unknown) => {
				if (error instanceof EnrollmentRefused) return;
				logger.warn({ err: error }, "Enrollment attempt failed; retrying");
				timer = setTimeout(attempt, RETRY_MS).unref();
			});
	};

	return {
		claims,
		router,
		redeem,
		// The server is listening by now: the gateway's challenge reaches it.
		start: () => {
			timer = setTimeout(attempt, 1_000).unref();
		},
		stop: () => clearTimeout(timer),
	};
}
