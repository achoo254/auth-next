import * as client from "openid-client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LOCALES } from "../i18n/locales.js";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import type { PushSender, PushTarget } from "../push/apns-client.js";
import {
	PUSH_KINDS,
	type PushEvent,
	pushPayload,
} from "../push/push-payload.js";
import {
	type SignedInApp,
	accountIosConfig,
	appSignIn,
	callApi,
	signedInApp,
} from "./helpers/account-ios-flows.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import { formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

interface Sent {
	readonly token: string;
	readonly payload: { readonly kind?: string };
}

const sent: Sent[] = [];
const sender: PushSender = {
	async send(target: PushTarget, payload: object) {
		sent.push({ token: target.token, payload });
		return { status: "sent" };
	},
	close() {},
};

let idp: TestIdp;
let counter = 0;

beforeAll(async () => {
	idp = await startTestIdp({
		interactions: "real",
		rateLimits: [],
		pushSender: sender,
	});
});

afterAll(async () => {
	await idp?.close();
});

beforeEach(() => {
	sent.length = 0;
});

/** A distinct hex APNs token. */
function nextToken(): string {
	counter += 1;
	return counter.toString(16).padStart(64, "0");
}

async function register(app: { accessToken: string }): Promise<string> {
	const token = nextToken();
	const answer = await callApi(idp, "/push-device", {
		method: "PUT",
		token: app.accessToken,
		body: { token, environment: "sandbox", locale: "en-GB" },
	});
	expect(answer.status).toBe(204);
	return token;
}

/** The kinds `token` received so far (notices are sent in the background). */
function kindsFor(token: string): (string | undefined)[] {
	return sent.filter((s) => s.token === token).map((s) => s.payload.kind);
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 150));
}

/** A second phone of the same account (its own grant). */
async function secondPhone(app: SignedInApp): Promise<{ accessToken: string }> {
	const tokens = await appSignIn(idp, app.browser);
	return { accessToken: tokens.access_token };
}

describe("push payloads", () => {
	const EVENTS: readonly PushEvent[] = [
		{ kind: "new-sign-in" },
		{ kind: "provider-linked", provider: "github" },
		{ kind: "provider-unlinked", provider: "apple" },
		{ kind: "email-reclaimed", provider: "google" },
		{ kind: "access-revoked", appName: "Localman" },
		{ kind: "access-revoked" },
	];

	it("cover every kind and never carry an email, URL, domain, code or token", () => {
		expect(new Set(EVENTS.map((e) => e.kind))).toEqual(new Set(PUSH_KINDS));
		for (const locale of LOCALES) {
			for (const event of EVENTS) {
				const payload = pushPayload(event, locale, {
					name: "hoandat",
					domain: "hoandat.com",
				});
				const text = JSON.stringify(payload);
				expect(text, `${locale} ${event.kind}`).not.toMatch(/@/);
				expect(text).not.toMatch(/https?:|www\.|\.com|\/\//);
				expect(text).not.toMatch(/\{\w+\}/);
				expect(Object.keys(payload).sort()).toEqual(["aps", "at", "kind"]);
			}
		}
	});
});

describe("notifyAccount", () => {
	it("tells the other phones, not the one that acted", async () => {
		const app = await signedInApp(idp);
		const mine = await register(app);
		const other = await secondPhone(app);
		const theirs = await register(other);
		sent.length = 0;
		const browser = await signedInBrowser(idp, app.account);
		const uid = (
			await idp.db
				.collection<{ payload: { uid: string } }>(collectionNameFor("Session"))
				.findOne({ "payload.accountId": app.account._id })
		)?.payload.uid;
		expect(browser).toBeDefined();
		await settle();
		// A web sign-in: every phone hears of it.
		expect(kindsFor(mine)).toContain("new-sign-in");
		expect(kindsFor(theirs)).toContain("new-sign-in");
		sent.length = 0;
		const out = await callApi(idp, `/sessions/${uid}/revoke`, {
			method: "POST",
			token: other.accessToken,
		});
		expect(out.status).toBe(204);
		await settle();
		expect(kindsFor(mine)).toEqual(["access-revoked"]);
		expect(kindsFor(theirs)).toEqual([]);
	});

	it("announces a new phone's sign-in to the others only", async () => {
		const app = await signedInApp(idp);
		const mine = await register(app);
		sent.length = 0;
		await secondPhone(app);
		await settle();
		expect(kindsFor(mine)).toEqual(["new-sign-in"]);
	});

	it("never reaches a phone whose grant was revoked, signed out or expired", async () => {
		const app = await signedInApp(idp);
		const config = await accountIosConfig(idp);

		// 1. Signed out through /token/revocation (the app's sign-out).
		const revoked = await secondPhone(app);
		const revokedToken = await register(revoked);
		const revokedRefresh = await appSignIn(idp, app.browser);
		const viaRefresh = await register({
			accessToken: revokedRefresh.access_token,
		});
		await client.tokenRevocation(config, revokedRefresh.refresh_token ?? "");
		await expect
			.poll(() =>
				idp.db.collection("push_devices").countDocuments({ token: viaRefresh }),
			)
			.toBe(0);

		// 2. Revoked on the web at /account.
		const grantId = (await idp.provider.AccessToken.find(revoked.accessToken))
			?.grantId;
		const page = await (
			await app.browser.request(`${idp.issuer}/account`)
		).text();
		await app.browser.request(
			`${idp.issuer}/account/devices/${grantId}/revoke`,
			{ form: { csrf: formField(page, "csrf") } },
		);
		expect(
			await idp.db
				.collection("push_devices")
				.countDocuments({ token: revokedToken }),
		).toBe(0);

		// 3. Expired: the grant lapsed before the TTL monitor removed anything.
		const expiring = await secondPhone(app);
		const expiringToken = await register(expiring);
		const expiringGrant = (
			await idp.provider.AccessToken.find(expiring.accessToken)
		)?.grantId;
		await idp.db
			.collection<{ _id: string }>(collectionNameFor("Grant"))
			.updateOne(
				{ _id: expiringGrant ?? "" },
				{ $set: { "payload.exp": Math.floor(Date.now() / 1000) - 60 } },
			);

		const mine = await register(app);
		sent.length = 0;
		await signedInBrowser(idp, app.account);
		await settle();
		expect(kindsFor(mine)).toContain("new-sign-in");
		for (const token of [revokedToken, viaRefresh, expiringToken]) {
			expect(kindsFor(token)).toEqual([]);
		}
		// The expired phone's row is dropped on the way.
		expect(
			await idp.db
				.collection("push_devices")
				.countDocuments({ token: expiringToken }),
		).toBe(0);
	});

	it("keeps a phone as long as its grant: refreshing slides both", async () => {
		const app = await signedInApp(idp);
		const token = await register(app);
		const grantId = (await idp.provider.AccessToken.find(app.accessToken))
			?.grantId;
		const soon = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
		await idp.db
			.collection<{ _id: string }>(collectionNameFor("Grant"))
			.updateOne(
				{ _id: grantId ?? "" },
				{ $set: { "payload.exp": soon, expiresAt: new Date(soon * 1000) } },
			);
		await idp.db
			.collection("push_devices")
			.updateOne({ token }, { $set: { expiresAt: new Date(soon * 1000) } });
		await client.refreshTokenGrant(
			await accountIosConfig(idp),
			app.tokens.refresh_token ?? "",
		);
		const stored = await idp.db
			.collection<{ expiresAt: Date }>("push_devices")
			.findOne({ token });
		expect(stored?.expiresAt.getTime()).toBeGreaterThan(
			Date.now() + 29 * 24 * 60 * 60 * 1000,
		);
	});

	it("deletion removes the account's phones", async () => {
		const app = await signedInApp(idp);
		await register(app);
		const idToken = (await appSignIn(idp, app.browser, app.account)).id_token;
		const deleted = await callApi(idp, "/", {
			method: "DELETE",
			token: app.accessToken,
			body: { id_token: idToken, username: app.account.username },
		});
		expect(deleted.status).toBe(204);
		expect(
			await idp.db
				.collection("push_devices")
				.countDocuments({ accountId: app.account._id }),
		).toBe(0);
	});
});

describe("without APNs configured", () => {
	it("sends nothing and stores no device", async () => {
		const off = await startTestIdp({ interactions: "real", rateLimits: [] });
		try {
			expect(off.services.pushSender).toBeUndefined();
			const app = await signedInApp(off);
			const answer = await callApi(off, "/push-device", {
				method: "PUT",
				token: app.accessToken,
				body: { token: nextToken(), environment: "production" },
			});
			expect(answer.status).toBe(204);
			expect(await off.db.collection("push_devices").countDocuments()).toBe(0);
		} finally {
			await off.close();
		}
	});
});
