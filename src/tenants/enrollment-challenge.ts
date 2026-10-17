import { lookup } from "node:dns";
import { request } from "node:https";
import type { LookupFunction } from "node:net";
import { type JWK, SignJWT, importJWK, jwtVerify } from "jose";
import { SIGNING_ALG } from "../oidc/jwks.js";
import { selfHostedIssuer } from "./enrollment-bundle.js";
import { isPublicAddress } from "./public-address.js";

/**
 * Where an install waiting to enroll answers the gateway's challenge: it
 * proves the install redeeming a bundle is the one serving `auth.<d>`.
 */
export const ENROLLMENT_CHALLENGE_PATH = "/.well-known/hoandat-enrollment";
export const CHALLENGE_TYPE = "hoandat-enrollment-challenge+jwt";

const CHALLENGE_TIMEOUT_MS = 10_000;
const MAX_CHALLENGE_BYTES = 16 * 1024;

/** The install's answer: the nonce, for the gateway only, signed by its key. */
export async function signChallenge(
	installKey: JWK,
	nonce: string,
	gatewayIssuer: string,
): Promise<string> {
	return new SignJWT({ nonce })
		.setProtectedHeader({ alg: SIGNING_ALG, typ: CHALLENGE_TYPE })
		.setAudience(gatewayIssuer)
		.setIssuedAt()
		.setExpirationTime("5m")
		.sign(await importJWK(installKey, SIGNING_ALG));
}

/** True when `answer` is this nonce, for this gateway, signed by `installKey`. */
export async function verifyChallenge(
	answer: string,
	installKey: JWK,
	nonce: string,
	gatewayIssuer: string,
): Promise<boolean> {
	try {
		const { payload } = await jwtVerify(
			answer,
			await importJWK(installKey, SIGNING_ALG),
			{
				audience: gatewayIssuer,
				algorithms: [SIGNING_ALG],
				typ: CHALLENGE_TYPE,
			},
		);
		return payload.nonce === nonce;
	} catch {
		return false;
	}
}

/**
 * DNS lookup that refuses every non-public address, checked when the
 * socket connects: the answer used is the answer checked (no rebinding).
 */
const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
	lookup(hostname, { ...options, all: true }, (error, addresses) => {
		if (error) {
			callback(error, "", 0);
			return;
		}
		const usable = addresses.filter((entry) => isPublicAddress(entry.address));
		if (usable.length === 0 || usable.length !== addresses.length) {
			callback(
				Object.assign(new Error("Host resolves to a non-public address"), {
					code: "ENOTPUBLIC",
				}),
				"",
				0,
			);
			return;
		}
		if (options.all) {
			callback(null, usable);
			return;
		}
		const [first] = usable;
		callback(null, first?.address ?? "", first?.family ?? 4);
	});
};

/** Fetches a tenant install's challenge answer; undefined on any failure. */
export type ChallengeFetcher = (
	domain: string,
	nonce: string,
) => Promise<string | undefined>;

/**
 * GET `https://auth.<domain>/.well-known/hoandat-enrollment?nonce=<n>`:
 * HTTPS with a verified certificate, public addresses only, no redirects,
 * 10 seconds, 16 KiB. The body is never logged.
 */
export const fetchChallenge: ChallengeFetcher = (domain, nonce) => {
	const url = new URL(ENROLLMENT_CHALLENGE_PATH, selfHostedIssuer(domain));
	url.searchParams.set("nonce", nonce);
	return new Promise((resolve) => {
		const req = request(
			url,
			{
				method: "GET",
				lookup: publicOnlyLookup,
				timeout: CHALLENGE_TIMEOUT_MS,
			},
			(res) => {
				if (res.statusCode !== 200) {
					res.resume();
					resolve(undefined);
					return;
				}
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => {
					body += chunk;
					if (body.length > MAX_CHALLENGE_BYTES) {
						req.destroy();
						resolve(undefined);
					}
				});
				res.on("end", () => resolve(body.trim()));
			},
		);
		req.on("timeout", () => req.destroy());
		req.on("error", () => resolve(undefined));
		req.end();
	});
};
