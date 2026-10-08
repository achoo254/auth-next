/**
 * TEST ONLY. Fake authorization codes for the Google/GitHub fakes: the code
 * carries the profile, the nonce and the PKCE challenge (base64url JSON), so
 * the fake token endpoint can check PKCE and put the nonce in the ID token.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

export interface FakeProfile {
	readonly id: string;
	readonly email: string;
	readonly emailVerified: boolean;
	readonly name?: string;
}

/** What the fake authorize step remembers inside the code it hands out. */
export interface FakeGrant extends FakeProfile {
	readonly nonce?: string;
	readonly codeChallenge?: string;
}

export function encodeFakeCode(profile: FakeGrant): string {
	return Buffer.from(JSON.stringify(profile)).toString("base64url");
}

const fakeProfile = z.object({
	id: z.string(),
	email: z.string(),
	emailVerified: z.boolean(),
	name: z.string().optional(),
	nonce: z.string().optional(),
	codeChallenge: z.string().optional(),
});

export function decodeFakeCode(code: string): FakeGrant {
	const decoded: unknown = JSON.parse(
		Buffer.from(code, "base64url").toString("utf8"),
	);
	return fakeProfile.parse(decoded);
}

/** The token request's code_verifier must hash to the challenge sent earlier. */
export function pkceMatches(grant: FakeGrant, form: URLSearchParams): boolean {
	const verifier = form.get("code_verifier") ?? "";
	return (
		grant.codeChallenge !== undefined &&
		createHash("sha256").update(verifier).digest("base64url") ===
			grant.codeChallenge
	);
}

export function unsignedJwt(claims: object): string {
	const part = (value: object): string =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${part({ alg: "RS256", typ: "JWT" })}.${part(claims)}.c2ln`;
}

/** Where a fake authorize endpoint sends the browser back to. */
export function fakeAuthorizeRedirect(
	authorizeUrl: string,
	profile: FakeProfile,
): string {
	const url = new URL(authorizeUrl);
	const back = new URL(url.searchParams.get("redirect_uri") ?? "");
	const grant: FakeGrant = {
		...profile,
		nonce: url.searchParams.get("nonce") ?? undefined,
		codeChallenge: url.searchParams.get("code_challenge") ?? undefined,
	};
	back.searchParams.set("code", encodeFakeCode(grant));
	back.searchParams.set("state", url.searchParams.get("state") ?? "");
	return back.href;
}
