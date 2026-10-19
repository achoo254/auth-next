/**
 * TEST ONLY. Stands in for Sign in with Apple: wraps fetch (on top of the
 * Google/GitHub fakes) to answer Apple's token, keys and revoke endpoints,
 * signs ID tokens and notifications with its own RSA key, and checks every
 * client secret against the public half of a key written for the IdP.
 * The browser side (Apple's page posting back) is done by `appleAnswer`.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT, exportJWK, generateKeyPair, jwtVerify } from "jose";
import { z } from "zod";
import { sharedFakeUpstreams } from "./fake-upstreams.js";

export const FAKE_APPLE_SERVICES_ID = "com.example.auth.signin";
export const FAKE_APPLE_TEAM_ID = "TEAM123456";
export const FAKE_APPLE_KEY_ID = "KEY1234567";
const APPLE = "https://appleid.apple.com";

/** Who signs in at the fake Apple; carried inside the code. */
export interface FakeAppleGrant {
	readonly sub: string;
	readonly email?: string;
	readonly isPrivateEmail?: boolean;
	readonly nonce?: string;
	/** Signs the ID token with a key Apple does not publish. */
	readonly forgeSignature?: boolean;
	readonly audience?: string;
}

const grantSchema = z.object({
	sub: z.string(),
	email: z.string().optional(),
	isPrivateEmail: z.boolean().optional(),
	nonce: z.string().optional(),
	forgeSignature: z.boolean().optional(),
	audience: z.string().optional(),
});

export function encodeAppleCode(grant: FakeAppleGrant): string {
	return Buffer.from(JSON.stringify(grant)).toString("base64url");
}

type RsaKeys = Awaited<ReturnType<typeof generateKeyPair>>;

export class FakeApple {
	readonly revoked: string[] = [];
	/** Environment enabling Apple at the IdP against this fake. */
	readonly env: Readonly<Record<string, string>>;
	private readonly clientPublicKey;
	private appleKeys?: Promise<{ real: RsaKeys; forged: RsaKeys }>;

	constructor() {
		const { privateKey, publicKey } = generateKeyPairSync("ec", {
			namedCurve: "prime256v1",
		});
		const dir = mkdtempSync(join(tmpdir(), "fake-apple-"));
		const keyPath = join(dir, "AuthKey.p8");
		writeFileSync(
			keyPath,
			privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
			{ mode: 0o600 },
		);
		this.clientPublicKey = publicKey;
		this.env = {
			APPLE_TEAM_ID: FAKE_APPLE_TEAM_ID,
			APPLE_SERVICES_ID: FAKE_APPLE_SERVICES_ID,
			APPLE_KEY_ID: FAKE_APPLE_KEY_ID,
			APPLE_PRIVATE_KEY_PATH: keyPath,
		};
	}

	private keys(): Promise<{ real: RsaKeys; forged: RsaKeys }> {
		this.appleKeys ??= Promise.all([
			generateKeyPair("RS256"),
			generateKeyPair("RS256"),
		]).then(([real, forged]) => ({ real, forged }));
		return this.appleKeys;
	}

	/** A JWT signed like Apple's (or with an unpublished key). */
	async sign(claims: Record<string, unknown>, forged = false): Promise<string> {
		const { real, forged: other } = await this.keys();
		return new SignJWT(claims)
			.setProtectedHeader({ alg: "RS256", kid: "fake-apple" })
			.setIssuer(APPLE)
			.setIssuedAt()
			.setExpirationTime("10m")
			.sign((forged ? other : real).privateKey);
	}

	private async clientSecretValid(secret: string): Promise<boolean> {
		try {
			const { payload, protectedHeader } = await jwtVerify(
				secret,
				this.clientPublicKey,
				{ issuer: FAKE_APPLE_TEAM_ID, audience: APPLE, algorithms: ["ES256"] },
			);
			return (
				payload.sub === FAKE_APPLE_SERVICES_ID &&
				protectedHeader.kid === FAKE_APPLE_KEY_ID
			);
		} catch {
			return false;
		}
	}

	async handle(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/auth/keys") {
			const { real } = await this.keys();
			const jwk = await exportJWK(real.publicKey);
			return Response.json({
				keys: [{ ...jwk, kid: "fake-apple", alg: "RS256", use: "sig" }],
			});
		}
		const form = new URLSearchParams(await request.text());
		if (
			form.get("client_id") !== FAKE_APPLE_SERVICES_ID ||
			!(await this.clientSecretValid(form.get("client_secret") ?? ""))
		) {
			return Response.json({ error: "invalid_client" }, { status: 400 });
		}
		if (url.pathname === "/auth/revoke") {
			this.revoked.push(form.get("token") ?? "");
			return new Response(null, { status: 200 });
		}
		const grant = grantSchema.parse(
			JSON.parse(Buffer.from(form.get("code") ?? "", "base64url").toString()),
		);
		const idToken = await this.sign(
			{
				aud: grant.audience ?? FAKE_APPLE_SERVICES_ID,
				sub: grant.sub,
				nonce: grant.nonce,
				...(grant.email
					? {
							email: grant.email,
							email_verified: "true",
							is_private_email: grant.isPrivateEmail ? "true" : "false",
						}
					: {}),
			},
			grant.forgeSignature,
		);
		return Response.json({
			access_token: "apple-at",
			token_type: "Bearer",
			expires_in: 3600,
			refresh_token: `apple-rt.${grant.sub}`,
			id_token: idToken,
		});
	}
}

let shared: FakeApple | undefined;

/** This process's fake Apple, installed once over the other fakes. */
export function sharedFakeApple(): FakeApple {
	if (!shared) {
		sharedFakeUpstreams();
		const apple = new FakeApple();
		const inner = globalThis.fetch;
		globalThis.fetch = (input, init) => {
			const request = new Request(input, init);
			return new URL(request.url).origin === APPLE
				? apple.handle(request)
				: inner(request);
		};
		shared = apple;
	}
	return shared;
}

/**
 * What Apple's page posts back for an authorize URL the IdP built: the
 * form fields, aimed at its redirect_uri. `user` is Apple's first-time
 * name/email JSON.
 */
export function appleAnswer(
	authorizeUrl: URL,
	grant: Omit<FakeAppleGrant, "nonce">,
	user?: { firstName?: string; lastName?: string },
): { readonly action: string; readonly form: Record<string, string> } {
	const params = authorizeUrl.searchParams;
	const form: Record<string, string> = {
		state: params.get("state") ?? "",
		code: encodeAppleCode({
			...grant,
			nonce: params.get("nonce") ?? undefined,
		}),
	};
	if (user) {
		form.user = JSON.stringify({ name: user, email: grant.email });
	}
	return { action: params.get("redirect_uri") ?? "", form };
}
