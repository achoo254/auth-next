import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditOutboxCollection } from "../audit/audit-outbox.js";
import {
	CHAT_NOTICE_CLIENT_ID,
	CHAT_NOTICE_SCOPE,
	type ChatNoticeSender,
	createChatNoticeSender,
} from "../chat-notices/chat-notice-sender.js";
import { chatNoticesEndpoint } from "../config/integrations-env.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import { createTestAccount, repositoryOf } from "./helpers/test-accounts.js";
import { type TestBrowser, formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

const ENDPOINT = "https://chat.example.test/api/account-notices";

interface Delivered {
	readonly sub: string;
	readonly text: string;
}

const delivered: Delivered[] = [];
const recording: ChatNoticeSender = {
	async send(sub, text) {
		delivered.push({ sub, text });
	},
};

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({
		interactions: "real",
		rateLimits: [],
		chatNotices: recording,
	});
});

afterAll(async () => {
	await idp?.close();
});

beforeEach(() => {
	delivered.length = 0;
});

/** POSTs an /account form with the page's CSRF token; the redirect target. */
async function accountPost(
	browser: TestBrowser,
	path: string,
): Promise<string> {
	const page = await (await browser.request(`${idp.issuer}/account`)).text();
	const answer = await browser.request(`${idp.issuer}${path}`, {
		form: { csrf: formField(page, "csrf") },
	});
	return answer.headers.get("location") ?? "";
}

/** Waits for the background send of notifyAccount. */
async function settled(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("the Chat notice token", () => {
	it("is a 60-second access token Chat can check against the IdP's JWKS", async () => {
		const requests: { url: string; init: RequestInit }[] = [];
		const sender = createChatNoticeSender({
			endpoint: ENDPOINT,
			issuer: idp.issuer,
			jwks: idp.jwks,
			fetch: async (url, init) => {
				requests.push({ url: String(url), init: init ?? {} });
				return new Response(null, { status: 204 });
			},
		});
		await sender.send("acc_123", "Đăng nhập mới\nCó đăng nhập mới.");

		const [request] = requests;
		expect(request?.url).toBe(ENDPOINT);
		expect(JSON.parse(String(request?.init.body))).toEqual({
			text: "Đăng nhập mới\nCó đăng nhập mới.",
		});
		const authorization = new Headers(request?.init.headers).get(
			"authorization",
		);
		const token = authorization?.replace(/^Bearer /, "") ?? "";
		expect(decodeProtectedHeader(token)).toMatchObject({
			alg: "ES256",
			typ: "at+jwt",
		});
		// The published JWKS, as Chat reads it.
		const discovery = (await (
			await fetch(`${idp.issuer}/.well-known/openid-configuration`)
		).json()) as { jwks_uri: string };
		const keys = createRemoteJWKSet(new URL(discovery.jwks_uri));
		const { payload } = await jwtVerify(token, keys, {
			issuer: idp.issuer,
			audience: ENDPOINT,
			typ: "at+jwt",
		});
		expect(payload).toMatchObject({
			sub: "acc_123",
			client_id: CHAT_NOTICE_CLIENT_ID,
			scope: CHAT_NOTICE_SCOPE,
		});
		expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(60);
		expect(payload.jti).toEqual(expect.any(String));
	});

	it("fails when Chat does not answer 204", async () => {
		const sender = createChatNoticeSender({
			endpoint: ENDPOINT,
			issuer: idp.issuer,
			jwks: idp.jwks,
			fetch: async () => new Response("{}", { status: 401 }),
		});
		await expect(sender.send("acc_123", "x")).rejects.toThrow("401");
	});

	it("points at /api/account-notices of the configured origin", () => {
		expect(
			chatNoticesEndpoint({ CHAT_NOTICES_URL: "https://chat.example.test/" }),
		).toBe(ENDPOINT);
		expect(chatNoticesEndpoint({})).toBeUndefined();
	});
});

describe("/account switch for notices through Chat", () => {
	it("turns them on in the page's language, sends notices, then turns them off", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const stored = await idp.services.accounts.findActiveById(account._id);
		const before = await (
			await browser.request(`${idp.issuer}/account`)
		).text();
		expect(before).toContain('data-id="chat-notices-on"');

		expect(await accountPost(browser, "/account/chat-notices/on")).toBe(
			"/account?notice=chat-notices-on#account-telegram",
		);
		const on = await idp.services.accounts.findActiveById(account._id);
		expect(on?.chatNotices?.locale).toEqual(expect.any(String));
		expect(on?.securityVersion).toBe((stored?.securityVersion ?? 0) + 1);
		const linked = await auditOutboxCollection(idp.db).findOne({
			sub: account._id,
			type: "method.linked",
		});
		expect(linked?.data).toEqual({ method: "chat" });

		// Signing another browser out is a security notice.
		await signedInBrowser(idp, account);
		const page = await (await browser.request(`${idp.issuer}/account`)).text();
		const current =
			/data-id="session-([\w-]+)">\s*<div><b>[^<]*<\/b> <span[^>]*data-id="session-current"/.exec(
				page,
			)?.[1];
		const other = [...page.matchAll(/data-id="session-revoke-([\w-]+)"/g)]
			.map((match) => match[1])
			.find((uid) => uid !== current);
		expect(current).toEqual(expect.any(String));
		expect(other).toEqual(expect.any(String));
		await accountPost(browser, `/account/sessions/${other ?? ""}/revoke`);
		await settled();
		expect(delivered.map((notice) => notice.sub)).toContain(account._id);

		expect(await accountPost(browser, "/account/chat-notices/off")).toBe(
			"/account?notice=chat-notices-off#account-telegram",
		);
		const off = await idp.services.accounts.findActiveById(account._id);
		expect(off?.chatNotices).toBeUndefined();
		const unlinked = await auditOutboxCollection(idp.db).findOne({
			sub: account._id,
			type: "method.unlinked",
		});
		expect(unlinked?.data).toEqual({ method: "chat" });
	});

	it("turns on without a recent sign-in, but asks again before turning off", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		// The sign-in happened 11 minutes ago.
		await idp.db
			.collection("oidc_session")
			.updateMany(
				{ "payload.accountId": account._id },
				{ $inc: { "payload.loginTs": -11 * 60 } },
			);
		expect(await accountPost(browser, "/account/chat-notices/on")).toBe(
			"/account?notice=chat-notices-on#account-telegram",
		);
		const off = new URL(
			await accountPost(browser, "/account/chat-notices/off"),
			idp.issuer,
		);
		expect(off.pathname).toBe("/auth");
		expect(off.searchParams.get("prompt")).toBe("login");
		const after = await idp.services.accounts.findActiveById(account._id);
		expect(after?.chatNotices).toBeDefined();
	});

	it("refuses a toggle without the page's CSRF token", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const forged = await browser.request(
			`${idp.issuer}/account/chat-notices/on`,
			{ form: { csrf: "forged" } },
		);
		expect(forged.headers.get("location")).toBe("/account?notice=expired");
		const after = await idp.services.accounts.findActiveById(account._id);
		expect(after?.chatNotices).toBeUndefined();
	});

	it("has no switch and no route while the channel is off", async () => {
		const off = await startTestIdp({ interactions: "real", rateLimits: [] });
		try {
			const account = await createTestAccount(repositoryOf(off));
			const browser = await signedInBrowser(off, account);
			const page = await (
				await browser.request(`${off.issuer}/account`)
			).text();
			expect(page).not.toContain("chat-notices");
			const answer = await browser.request(
				`${off.issuer}/account/chat-notices/on`,
				{ form: { csrf: formField(page, "csrf") } },
			);
			expect(answer.status).toBe(404);
		} finally {
			await off.close();
		}
	});
});
