import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { revokeGrant } from "../account-portal/grant-directory.js";
import { accountsCollection } from "../accounts/user-model.js";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import {
	TUNELO_CALLBACK,
	codeTokens,
	exchange,
	localmanSignIn,
	localmanWeb,
	rejectedWith,
	signInToLocalman,
	tuneloWeb,
} from "./helpers/exchange-flows.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { formField } from "./helpers/test-browser.js";
import {
	LOCALMAN_CALLBACK,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";

let idp: TestIdp;
let localman: client.Configuration;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
	localman = await localmanWeb(idp);
});

afterAll(async () => {
	await idp?.close();
});

function signIn() {
	return signInToLocalman(idp);
}

function accessTokens() {
	return idp.db.collection<{
		_id: string;
		payload: { grantId?: string; exp?: number };
	}>(collectionNameFor("AccessToken"));
}

async function grantIdOf(subject: string): Promise<string> {
	const stored = await accessTokens().findOne({ _id: subject });
	if (!stored?.payload.grantId) throw new Error("subject token not stored");
	return stored.payload.grantId;
}

describe("the subject token must be live and Localman's", () => {
	it("refuses a token issued to another client", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const { browser } = await localmanSignIn(idp, account);
		const tunelo = await codeTokens(
			await tuneloWeb(idp),
			browser,
			TUNELO_CALLBACK,
			"openid profile",
		);
		await expect(exchange(localman, tunelo.access_token)).rejects.toMatchObject(
			rejectedWith("invalid_request"),
		);
	});

	it("refuses JWT access tokens and garbage", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const jwt = await localmanSignIn(idp, account, "openid mock:read");
		expect(jwt.accessToken.split(".")).toHaveLength(3);
		for (const subject of [jwt.accessToken, "not-a-token"]) {
			await expect(exchange(localman, subject)).rejects.toMatchObject(
				rejectedWith("invalid_request"),
			);
		}
	});

	it("refuses an expired token", async () => {
		const { subject } = await signIn();
		const past = Math.floor(Date.now() / 1000) - 60;
		await accessTokens().updateOne(
			{ _id: subject },
			{ $set: { "payload.exp": past, expiresAt: new Date(past * 1000) } },
		);
		await expect(exchange(localman, subject)).rejects.toMatchObject(
			rejectedWith("invalid_request"),
		);
	});

	it("refuses a token revoked at the revocation endpoint", async () => {
		const { subject } = await signIn();
		await client.tokenRevocation(localman, subject);
		await expect(exchange(localman, subject)).rejects.toMatchObject(
			rejectedWith("invalid_request"),
		);
	});

	it("refuses a token whose grant was revoked or is gone", async () => {
		const revoked = await signIn();
		await revokeGrant(
			idp.provider,
			revoked.accountId,
			await grantIdOf(revoked.subject),
		);
		const orphan = await signIn();
		await idp.db
			.collection<{ _id: string }>(collectionNameFor("Grant"))
			.deleteOne({ _id: await grantIdOf(orphan.subject) });
		for (const { subject } of [revoked, orphan]) {
			await expect(exchange(localman, subject)).rejects.toMatchObject(
				rejectedWith("invalid_request"),
			);
		}
	});

	it("refuses once the account is disabled", async () => {
		const disabled = await signIn();
		await accountsCollection(idp.db).updateOne(
			{ _id: disabled.accountId },
			{ $set: { disabledAt: new Date() } },
		);
		await expect(exchange(localman, disabled.subject)).rejects.toMatchObject(
			rejectedWith("invalid_request"),
		);
	});

	it("ignores a review flag left over from the old password reset", async () => {
		const legacy = await signIn();
		await accountsCollection(idp.db).updateOne(
			{ _id: legacy.accountId },
			{ $set: { securityReviewPendingSince: new Date() } },
		);
		const issued = await exchange(localman, legacy.subject);
		expect(issued.access_token).toEqual(expect.any(String));
	});

	it("dies with the IdP session: logout ends refresh and exchange", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const tokens = await codeTokens(
			localman,
			browser,
			LOCALMAN_CALLBACK,
			"openid profile email",
		);
		const refreshToken = tokens.refresh_token;
		if (!refreshToken) throw new Error("no refresh token for localman-web");
		await exchange(localman, tokens.access_token);

		const ask = await (
			await browser.request(`${idp.issuer}/session/end`)
		).text();
		await submitForm(browser, `${idp.issuer}/session/end/confirm`, {
			xsrf: formField(ask, "xsrf"),
			logout: "yes",
		});
		await expect(
			client.refreshTokenGrant(localman, refreshToken),
		).rejects.toMatchObject(rejectedWith("invalid_grant"));
		await expect(exchange(localman, tokens.access_token)).rejects.toMatchObject(
			rejectedWith("invalid_request"),
		);
	});
});
