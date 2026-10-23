import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type SignedInApp,
	appSignIn,
	callApi,
	signedInApp,
} from "./helpers/account-ios-flows.js";
import { localmanSignIn } from "./helpers/exchange-flows.js";
import {
	cliLogin,
	sessionUidOf,
	signedInBrowser,
} from "./helpers/session-flows.js";
import { type TestBrowser, formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

interface Recorded {
	readonly type: string;
	readonly data: unknown;
	readonly hasContext: boolean;
}

/**
 * Events the account actions record. Sign-ins of the setup (and of the
 * re-authentication) are recorded too, so they are left out.
 */
const ACTION_EVENTS = [
	"session.revoked",
	"grant.revoked",
	"method.unlinked",
	"method.linked",
];

/** Action events of `sub` after the first `since`, without timing. */
async function eventsOf(sub: string, since: number): Promise<Recorded[]> {
	const events = await idp.db
		.collection<{ type: string; data: unknown; context?: object }>(
			"audit_outbox",
		)
		.find({ sub, type: { $in: ACTION_EVENTS } })
		.sort({ _id: 1 })
		.toArray();
	return events.slice(since).map((event) => ({
		type: event.type,
		data: event.data,
		hasContext: event.context !== undefined,
	}));
}

async function countOf(sub: string): Promise<number> {
	return idp.db
		.collection("audit_outbox")
		.countDocuments({ sub, type: { $in: ACTION_EVENTS } });
}

async function webPost(browser: TestBrowser, path: string): Promise<string> {
	const page = await (await browser.request(`${idp.issuer}/account`)).text();
	const answer = await browser.request(`${idp.issuer}/account${path}`, {
		form: { csrf: formField(page, "csrf") },
	});
	return answer.headers.get("location") ?? "";
}

function twoProviders(): SignedInApp["account"]["providers"] {
	return { google: `g-${randomUUID()}`, github: String(randomInt(1, 2 ** 47)) };
}

/**
 * Runs the same action on the web (account A) and the API (account B) and
 * compares the events each recorded. `api` gets ready first (a fresh sign-in
 * records its own events), then calls `ready()` just before acting.
 */
async function compare(
	web: (app: SignedInApp) => Promise<void>,
	api: (app: SignedInApp, ready: () => Promise<void>) => Promise<number>,
): Promise<void> {
	const a = await signedInApp(idp, twoProviders());
	const b = await signedInApp(idp, twoProviders());
	for (const app of [a, b]) {
		await localmanSignIn(idp, app.account);
		await cliLogin(idp, app.browser);
	}
	const sinceA = await countOf(a.account._id);
	let sinceB = await countOf(b.account._id);
	await web(a);
	const status = await api(b, async () => {
		sinceB = await countOf(b.account._id);
	});
	expect(status).toBe(204);
	const webEvents = await eventsOf(a.account._id, sinceA);
	expect(webEvents.length).toBeGreaterThan(0);
	expect(await eventsOf(b.account._id, sinceB)).toEqual(webEvents);
}

async function cliGrant(app: SignedInApp): Promise<string> {
	const grant = await idp.db.collection<{ _id: string }>("oidc_grant").findOne({
		"payload.accountId": app.account._id,
		"payload.clientId": "tunelo-cli",
	});
	return grant?._id ?? "";
}

describe("web /account and /api/account record the same audit events", () => {
	it("signing one session out", async () => {
		await compare(
			async (a) => {
				await webPost(
					a.browser,
					`/sessions/${await sessionUidOf(idp, a.account._id)}/revoke`,
				);
			},
			async (b) => {
				const uid = await sessionUidOf(idp, b.account._id);
				return (
					await callApi(idp, `/sessions/${uid}/revoke`, {
						method: "POST",
						token: b.accessToken,
					})
				).status;
			},
		);
	});

	it("revoking a device", async () => {
		await compare(
			async (a) => {
				await webPost(a.browser, `/devices/${await cliGrant(a)}/revoke`);
			},
			async (b) =>
				(
					await callApi(idp, `/devices/${await cliGrant(b)}/revoke`, {
						method: "POST",
						token: b.accessToken,
					})
				).status,
		);
	});

	it("removing an app's access", async () => {
		await compare(
			async (a) => {
				await webPost(a.browser, "/apps/localman-web/revoke");
			},
			async (b, ready) => {
				const idToken = (await appSignIn(idp, b.browser, b.account)).id_token;
				await ready();
				return (
					await callApi(idp, "/apps/localman-web/revoke", {
						method: "POST",
						token: b.accessToken,
						body: { id_token: idToken },
					})
				).status;
			},
		);
	});

	it("unlinking a provider", async () => {
		await compare(
			async (a) => {
				expect(await webPost(a.browser, "/unlink/github")).toBe(
					"/account?notice=unlinked",
				);
			},
			async (b, ready) => {
				const idToken = (await appSignIn(idp, b.browser, b.account)).id_token;
				await ready();
				return (
					await callApi(idp, "/providers/github/unlink", {
						method: "POST",
						token: b.accessToken,
						body: { id_token: idToken },
					})
				).status;
			},
		);
	});
});

describe("guards stay as strong as the web's", () => {
	it("sign-out of every session needs a fresh sign-in on both", async () => {
		const app = await signedInApp(idp);
		await signedInBrowser(idp, app.account);
		const refused = await callApi(idp, "/sessions/revoke-all", {
			method: "POST",
			token: app.accessToken,
			body: {},
		});
		expect(refused.status).toBe(403);
		await idp.db
			.collection("oidc_session")
			.updateMany(
				{ "payload.accountId": app.account._id },
				{ $inc: { "payload.loginTs": -11 * 60 } },
			);
		const location = await webPost(app.browser, "/sessions/revoke-others");
		expect(new URL(location, idp.issuer).searchParams.get("prompt")).toBe(
			"login",
		);
	});
});
