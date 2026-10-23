import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import {
	type SignedInApp,
	appSignIn,
	callApi,
	signedInApp,
} from "./helpers/account-ios-flows.js";
import { createTestAccount, repositoryOf } from "./helpers/test-accounts.js";
import { TestBrowser } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

let idp: TestIdp;

/** GitHub account ids are numbers. */
function githubId(): string {
	return String(randomInt(1, 2 ** 47));
}

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

/** POST .../providers/github/link after a fresh sign-in: the start URL. */
async function linkStart(app: SignedInApp): Promise<string> {
	const idToken = (await appSignIn(idp, app.browser, app.account)).id_token;
	const answer = await callApi(idp, "/providers/github/link", {
		method: "POST",
		token: app.accessToken,
		body: { id_token: idToken },
	});
	expect(answer.status).toBe(200);
	const { url } = await answer.json();
	return url;
}

/** Opens the start URL in a new browser sheet (no IdP cookie) as GitHub `id`. */
async function openSheet(
	url: string,
	id: string,
	browser = new TestBrowser(),
): Promise<URL | undefined> {
	idp.fake.nextLogins.push({
		id,
		email: `gh${id}@example.com`,
		emailVerified: true,
	});
	const { location } = await browser.navigate(
		url,
		{},
		`${idp.issuer}/ios/linked`,
	);
	return location;
}

async function sessionCount(accountId: string): Promise<number> {
	return idp.db
		.collection(collectionNameFor("Session"))
		.countDocuments({ "payload.accountId": accountId });
}

describe("linking a provider from the app", () => {
	it("links without any IdP session and creates none", async () => {
		const app = await signedInApp(idp);
		const url = await linkStart(app);
		const before = await sessionCount(app.account._id);
		const id = githubId();
		const sheet = new TestBrowser();
		const back = await openSheet(url, id, sheet);
		expect(back?.searchParams.get("result")).toBe("linked");
		expect(back?.searchParams.get("provider")).toBe("github");
		const after = await repositoryOf(idp).findActiveById(app.account._id);
		expect(after?.providers.github).toBe(id);
		// Still every way in it had.
		expect(after?.providers.google).toBe(app.account.providers.google);
		expect(await sessionCount(app.account._id)).toBe(before);
		const page = await sheet.request(`${idp.issuer}/account`);
		// The sheet is not signed in to /account: it goes to the login.
		expect(page.status).toBe(303);
		const event = await idp.db
			.collection<{ type: string; data: { method?: string } }>("audit_outbox")
			.findOne({ sub: app.account._id, type: "method.linked" });
		expect(event?.data.method).toBe("github");
	});

	it("opens a link state once", async () => {
		const app = await signedInApp(idp);
		const url = await linkStart(app);
		const sheet = new TestBrowser();
		const first = await sheet.request(url);
		expect(first.status).toBe(303);
		const second = await new TestBrowser().navigate(
			url,
			{},
			`${idp.issuer}/ios/linked`,
		);
		expect(second.location?.searchParams.get("result")).toBe("expired");
	});

	it("refuses a state after a security change of the account", async () => {
		const app = await signedInApp(idp);
		const url = await linkStart(app);
		await repositoryOf(idp).links.setTelegram(app.account._id, {
			chatId: `${Date.now()}`,
		});
		const back = await openSheet(url, githubId());
		expect(back?.searchParams.get("result")).toBe("expired");
		expect(
			(await repositoryOf(idp).findActiveById(app.account._id))?.providers
				.github,
		).toBeUndefined();
		idp.fake.nextLogins.length = 0;
	});

	it("refuses a provider account of someone else, and a revoked app grant", async () => {
		const owner = await createTestAccount(repositoryOf(idp), {
			providers: { google: `g-${randomUUID()}`, github: githubId() },
		});
		const app = await signedInApp(idp);
		const taken = await openSheet(
			await linkStart(app),
			owner.providers.github ?? "",
		);
		expect(taken?.searchParams.get("result")).toBe("owned_by_other");

		const url = await linkStart(app);
		const grantId = (await idp.provider.AccessToken.find(app.accessToken))
			?.grantId;
		const sheet = new TestBrowser();
		// Started, then the phone is signed out before the provider answers.
		const start = await sheet.request(url);
		const provider = new URL(start.headers.get("location") ?? "");
		await (await idp.provider.Grant.find(grantId ?? ""))?.destroy();
		idp.fake.nextLogins.push({
			id: githubId(),
			email: "x@example.com",
			emailVerified: true,
		});
		const { location } = await sheet.navigate(
			provider,
			{},
			`${idp.issuer}/ios/linked`,
		);
		expect(location?.searchParams.get("result")).toBe("expired");
		expect(
			(await repositoryOf(idp).findActiveById(app.account._id))?.providers
				.github,
		).toBeUndefined();
	});

	it("ends on the app when the user cancels at the provider", async () => {
		const app = await signedInApp(idp);
		const sheet = new TestBrowser();
		const start = await sheet.request(await linkStart(app));
		const provider = new URL(start.headers.get("location") ?? "");
		const callback = new URL(provider.searchParams.get("redirect_uri") ?? "");
		callback.searchParams.set("error", "access_denied");
		callback.searchParams.set(
			"state",
			provider.searchParams.get("state") ?? "",
		);
		const { location } = await sheet.navigate(
			callback,
			{},
			`${idp.issuer}/ios/linked`,
		);
		expect(location?.searchParams.get("result")).toBe("cancelled");
	});
});
