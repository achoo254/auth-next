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

/** The app's confirmation of the `ref` its sheet brought back. */
async function complete(
	app: { readonly accessToken: string },
	ref: string | null | undefined,
	provider = "github",
): Promise<Response> {
	return callApi(idp, `/providers/${provider}/link/complete`, {
		method: "POST",
		token: app.accessToken,
		body: { ref: ref ?? "" },
	});
}

async function githubOf(accountId: string): Promise<string | undefined> {
	return (await repositoryOf(idp).findActiveById(accountId))?.providers.github;
}

async function sessionCount(accountId: string): Promise<number> {
	return idp.db
		.collection(collectionNameFor("Session"))
		.countDocuments({ "payload.accountId": accountId });
}

describe("linking a provider from the app", () => {
	it("links only once the app confirms, without any IdP session", async () => {
		const app = await signedInApp(idp);
		const url = await linkStart(app);
		const before = await sessionCount(app.account._id);
		const id = githubId();
		const sheet = new TestBrowser();
		const back = await openSheet(url, id, sheet);
		expect(back?.searchParams.get("result")).toBe("pending");
		expect(back?.searchParams.get("provider")).toBe("github");
		const ref = back?.searchParams.get("ref");
		expect(ref?.length).toBeGreaterThanOrEqual(43);
		// Nothing is linked by the browser step alone.
		expect(await githubOf(app.account._id)).toBeUndefined();
		const done = await complete(app, ref);
		expect(done.status).toBe(200);
		expect(await done.json()).toEqual({ result: "linked" });
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
		// Single use.
		expect((await complete(app, ref)).status).toBe(404);
	});

	it("a link URL opened in someone else's browser cannot link into its creator's account", async () => {
		const attacker = await signedInApp(idp);
		const victim = await signedInApp(idp);
		const url = await linkStart(attacker);
		// The victim opens the attacker's URL and signs in to their own GitHub.
		const victimGithub = githubId();
		const back = await openSheet(url, victimGithub);
		const ref = back?.searchParams.get("ref");
		// The attacker never sees the victim's sheet, so no ref: a guess fails.
		expect((await complete(attacker, "guessed-ref")).status).toBe(404);
		// The victim's own app (another grant, another account) cannot use it.
		const refused = await complete(victim, ref);
		expect(refused.status).toBe(404);
		expect((await refused.json()).error).toBe("not_found");
		expect(await githubOf(attacker.account._id)).toBeUndefined();
		expect(await githubOf(victim.account._id)).toBeUndefined();
	});

	it("refuses a ref of another grant of the same account, another provider, or expired", async () => {
		const app = await signedInApp(idp);
		const otherPhone = {
			accessToken: (await appSignIn(idp, app.browser)).access_token,
		};
		const back = await openSheet(await linkStart(app), githubId());
		const ref = back?.searchParams.get("ref");
		expect((await complete(otherPhone, ref)).status).toBe(404);
		expect((await complete(app, ref, "google")).status).toBe(404);
		// Not used up by the refusals: the right grant can still confirm.
		expect(await (await complete(app, ref)).json()).toEqual({
			result: "linked",
		});

		const late = await signedInApp(idp);
		const lateRef = (
			await openSheet(await linkStart(late), githubId())
		)?.searchParams.get("ref");
		await idp.db
			.collection("one_time_tokens")
			.updateMany(
				{ kind: "app-link-result", "data.accountId": late.account._id },
				{ $set: { expiresAt: new Date(Date.now() - 1000) } },
			);
		expect((await complete(late, lateRef)).status).toBe(404);
		expect(await githubOf(late.account._id)).toBeUndefined();
	});

	it("voids a held result after a security change of the account", async () => {
		const app = await signedInApp(idp);
		const ref = (
			await openSheet(await linkStart(app), githubId())
		)?.searchParams.get("ref");
		await repositoryOf(idp).links.setTelegram(app.account._id, {
			chatId: `${Date.now()}`,
		});
		expect(await (await complete(app, ref)).json()).toEqual({
			result: "expired",
		});
		expect(await githubOf(app.account._id)).toBeUndefined();
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
		expect(
			await (await complete(app, taken?.searchParams.get("ref"))).json(),
		).toEqual({ result: "owned_by_other" });

		const back = await openSheet(await linkStart(app), githubId());
		const grantId = (await idp.provider.AccessToken.find(app.accessToken))
			?.grantId;
		// The phone is signed out before it confirms.
		await (await idp.provider.Grant.find(grantId ?? ""))?.destroy();
		expect((await complete(app, back?.searchParams.get("ref"))).status).toBe(
			401,
		);
		expect(await githubOf(app.account._id)).toBeUndefined();
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
