import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCOUNT_IOS_CLIENT_ID } from "../oidc/account-ios-client.js";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import {
	appSignIn,
	callApi,
	signedInApp,
} from "./helpers/account-ios-flows.js";
import { localmanSignIn } from "./helpers/exchange-flows.js";
import { sessionUidOf, signedInBrowser } from "./helpers/session-flows.js";
import { repositoryOf } from "./helpers/test-accounts.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

async function grantOf(accessToken: string): Promise<string | undefined> {
	return (await idp.provider.AccessToken.find(accessToken))?.grantId;
}

async function auditTypes(sub: string): Promise<string[]> {
	const events = await idp.db
		.collection<{ type: string }>("audit_outbox")
		.find({ sub })
		.sort({ _id: 1 })
		.toArray();
	return events.map((event) => event.type);
}

describe("endpoints", () => {
	it("GET / lists the account with allowed keys only", async () => {
		const app = await signedInApp(idp);
		await localmanSignIn(idp, app.account);
		const answer = await callApi(idp, "/", { token: app.accessToken });
		expect(answer.status).toBe(200);
		expect(answer.headers.get("cache-control")).toBe("no-store");
		const text = await answer.text();
		for (const secret of [
			"revocationToken",
			"securityVersion",
			"providerDetails",
			"tenantId",
			"chatId",
			"userAgent",
			"grantIds",
			app.account.providers.google ?? "",
		]) {
			expect(text).not.toContain(secret);
		}
		const view = JSON.parse(text);
		expect(Object.keys(view).sort()).toEqual([
			"account",
			"apps",
			"canDelete",
			"devices",
			"providers",
			"sessions",
			"telegram",
		]);
		expect(view.account.id).toBe(app.account._id);
		expect(view.canDelete).toBe(true);
		expect(view.devices).toEqual([
			expect.objectContaining({
				clientId: ACCOUNT_IOS_CLIENT_ID,
				current: true,
			}),
		]);
		expect(view.apps.map((a: { clientId: string }) => a.clientId)).toContain(
			"localman-web",
		);
		expect(
			view.providers.find((p: { provider: string }) => p.provider === "google"),
		).toMatchObject({ linked: true, enabled: true, canUnlink: false });
		expect(view.sessions.length).toBeGreaterThan(0);
	});

	it("PATCH /profile sets or clears the name", async () => {
		const app = await signedInApp(idp);
		const set = await callApi(idp, "/profile", {
			method: "PATCH",
			token: app.accessToken,
			body: { name: "  Hoà  " },
		});
		expect(set.status).toBe(204);
		expect(
			(await repositoryOf(idp).findActiveById(app.account._id))?.name,
		).toBe("Hoà");
		const long = await callApi(idp, "/profile", {
			method: "PATCH",
			token: app.accessToken,
			body: { name: "x".repeat(101) },
		});
		expect(long.status).toBe(400);
		expect((await long.json()).error).toBe("invalid_name");
		await callApi(idp, "/profile", {
			method: "PATCH",
			token: app.accessToken,
			body: { name: null },
		});
		expect(
			(await repositoryOf(idp).findActiveById(app.account._id))?.name,
		).toBeUndefined();
	});

	it("signs one session out and revokes one device, with the web's audit events", async () => {
		const app = await signedInApp(idp);
		const uid = await sessionUidOf(idp, app.account._id);
		const missing = await callApi(idp, "/sessions/nope/revoke", {
			method: "POST",
			token: app.accessToken,
		});
		expect(missing.status).toBe(404);
		const out = await callApi(idp, `/sessions/${uid}/revoke`, {
			method: "POST",
			token: app.accessToken,
		});
		expect(out.status).toBe(204);
		// The app grant is per device: signing the browser out leaves it.
		expect((await callApi(idp, "/", { token: app.accessToken })).status).toBe(
			200,
		);

		const browser = await signedInBrowser(idp, app.account);
		const second = await appSignIn(idp, browser);
		const secondGrant = await grantOf(second.access_token);
		const revoked = await callApi(idp, `/devices/${secondGrant}/revoke`, {
			method: "POST",
			token: app.accessToken,
		});
		expect(revoked.status).toBe(204);
		expect(
			(await callApi(idp, "/", { token: second.access_token })).status,
		).toBe(401);
		const types = await auditTypes(app.account._id);
		expect(types).toContain("session.revoked");
		expect(types).toContain("grant.revoked");
	});

	it("removes an app's access, signs out every browser, unlinks, and links", async () => {
		const app = await signedInApp(idp, {
			google: `g-${randomUUID()}`,
			github: `gh-${randomUUID()}`,
		});
		await localmanSignIn(idp, app.account);
		const reauth = async () =>
			(await appSignIn(idp, app.browser, app.account)).id_token;

		const removed = await callApi(idp, "/apps/localman-web/revoke", {
			method: "POST",
			token: app.accessToken,
			body: { id_token: await reauth() },
		});
		expect(removed.status).toBe(204);
		expect(
			await idp.db.collection(collectionNameFor("Grant")).countDocuments({
				"payload.accountId": app.account._id,
				"payload.clientId": "localman-web",
			}),
		).toBe(0);

		const all = await callApi(idp, "/sessions/revoke-all", {
			method: "POST",
			token: app.accessToken,
			body: { id_token: await reauth() },
		});
		expect(all.status).toBe(204);
		expect(
			await idp.db.collection(collectionNameFor("Session")).countDocuments({
				"payload.accountId": app.account._id,
			}),
		).toBe(0);

		// Already linked, or unknown: answered before the ID token is spent.
		const linked = await callApi(idp, "/providers/google/link", {
			method: "POST",
			token: app.accessToken,
			body: {},
		});
		expect(linked.status).toBe(409);
		expect((await linked.json()).error).toBe("already_linked");
		const unknown = await callApi(idp, "/providers/apple/link", {
			method: "POST",
			token: app.accessToken,
			body: {},
		});
		expect(unknown.status).toBe(409);
		expect((await unknown.json()).error).toBe("provider_unavailable");

		const browser = await signedInBrowser(idp, app.account);
		const token = (await appSignIn(idp, browser)).id_token;
		const unlinked = await callApi(idp, "/providers/github/unlink", {
			method: "POST",
			token: app.accessToken,
			body: { id_token: token },
		});
		expect(unlinked.status).toBe(204);
		const last = await callApi(idp, "/providers/google/unlink", {
			method: "POST",
			token: app.accessToken,
			body: {},
		});
		expect(last.status).toBe(409);
		expect((await last.json()).error).toBe("last_sign_in_method");
		const after = await repositoryOf(idp).findActiveById(app.account._id);
		expect(after?.providers.github).toBeUndefined();
		expect(after?.providers.google).toBe(app.account.providers.google);

		const link = await callApi(idp, "/providers/github/link", {
			method: "POST",
			token: app.accessToken,
			body: { id_token: (await appSignIn(idp, browser, app.account)).id_token },
		});
		expect(link.status).toBe(200);
		const { url } = await link.json();
		expect(new URL(url).pathname).toBe("/oauth/github/start");
		expect(await auditTypes(app.account._id)).toEqual(
			expect.arrayContaining([
				"grant.revoked",
				"session.revoked",
				"method.unlinked",
			]),
		);
	});

	it("registers push only when push is on", async () => {
		const app = await signedInApp(idp);
		const off = await callApi(idp, "/push-device", {
			method: "PUT",
			token: app.accessToken,
			body: { token: "ab".repeat(32), environment: "sandbox" },
		});
		expect(off.status).toBe(204);
		expect(
			await idp.db
				.collection("push_devices")
				.countDocuments({ accountId: app.account._id }),
		).toBe(0);
		const bad = await callApi(idp, "/push-device", {
			method: "PUT",
			token: app.accessToken,
			body: { token: "not-hex", environment: "sandbox" },
		});
		expect(bad.status).toBe(400);
		const gone = await callApi(idp, "/push-device", {
			method: "DELETE",
			token: app.accessToken,
		});
		expect(gone.status).toBe(204);
	});

	it("deletes the account after the username and a fresh sign-in", async () => {
		const app = await signedInApp(idp);
		const idToken = (await appSignIn(idp, app.browser, app.account)).id_token;
		const mismatch = await callApi(idp, "/", {
			method: "DELETE",
			token: app.accessToken,
			body: { id_token: idToken, username: "someone_else" },
		});
		expect(mismatch.status).toBe(400);
		expect((await mismatch.json()).error).toBe("username_mismatch");
		expect(
			await repositoryOf(idp).findActiveById(app.account._id),
		).toBeDefined();
		// The mismatch did not spend the ID token.
		const deleted = await callApi(idp, "/", {
			method: "DELETE",
			token: app.accessToken,
			body: { id_token: idToken, username: `@${app.account.username}` },
		});
		expect(deleted.status).toBe(204);
		expect(
			await repositoryOf(idp).findIncludingDisabled(app.account._id),
		).toBeUndefined();
		expect((await callApi(idp, "/", { token: app.accessToken })).status).toBe(
			401,
		);
		const event = await idp.db
			.collection<{ type: string; data: { source?: string } }>("audit_outbox")
			.findOne({ sub: app.account._id, type: "account.deleted" });
		expect(event?.data.source).toBe("app");
	});

	it("answers unknown paths with JSON 404", async () => {
		const app = await signedInApp(idp);
		const answer = await callApi(idp, "/nothing", { token: app.accessToken });
		expect(answer.status).toBe(404);
		expect(await answer.json()).toEqual({ error: "not_found" });
	});
});
