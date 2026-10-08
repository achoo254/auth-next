import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TELEGRAM_SENT_MESSAGE } from "../interactions/forgot-routes.js";
import {
	BAD_CREDENTIALS_MESSAGE,
	LOCKED_MESSAGE,
} from "../interactions/login-handler.js";
import { escapeHtml } from "../ui/html.js";
import { FAKE_UPSTREAM_ENV, FakeUpstreams } from "./helpers/fake-upstreams.js";
import {
	TEST_PASSWORD,
	createTestAccount,
	openLoginPage,
	postLogin,
	repositoryOf,
} from "./helpers/test-accounts.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

let idp: TestIdp;
const fake = new FakeUpstreams();
let uninstall: () => void;

beforeAll(async () => {
	uninstall = fake.install();
	idp = await startTestIdp({ interactions: "real", env: FAKE_UPSTREAM_ENV });
});

afterAll(async () => {
	uninstall?.();
	await idp?.close();
});

/** The page with per-request values (CSRF token, echoed input) removed. */
function comparable(html: string, identifier: string): string {
	return html
		.replace(/name="csrf" value="[^"]*"/g, "")
		.replaceAll(escapeHtml(identifier), "IDENTIFIER");
}

describe("password login", () => {
	it("rejects a missing CSRF token and signs in with the right password", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const page = await openLoginPage(idp);
		const forged = await page.browser.request(
			`${idp.issuer}/interaction/${page.uid}/login`,
			{ form: { identifier: account.username, password: TEST_PASSWORD } },
		);
		expect(forged.status).toBe(403);

		const ok = await postLogin(
			idp,
			page,
			account.email.toUpperCase(),
			TEST_PASSWORD,
		);
		expect(ok.status).toBe(303);
		expect(ok.headers.get("location")).toMatch(/\/auth\//);
	});

	it("locks the account for 15 minutes after 5 wrong passwords", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const page = await openLoginPage(idp);
		for (let attempt = 1; attempt <= 5; attempt += 1) {
			const response = await postLogin(
				idp,
				page,
				account.username,
				"wrong-password",
			);
			expect(response.status).toBe(401);
			expect(await response.text()).toContain(
				escapeHtml(BAD_CREDENTIALS_MESSAGE),
			);
		}
		const locked = await postLogin(idp, page, account.username, TEST_PASSWORD);
		expect(locked.status).toBe(429);
		expect(await locked.text()).toContain(LOCKED_MESSAGE);
	});
});

describe("account existence never leaks", () => {
	it("answers a wrong password and an unknown email the same way", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const page = await openLoginPage(idp);
		const time = async (
			identifier: string,
		): Promise<[Response, string, number]> => {
			const started = performance.now();
			const response = await postLogin(idp, page, identifier, "wrong-password");
			const html = await response.text();
			return [
				response,
				comparable(html, identifier),
				performance.now() - started,
			];
		};
		// Warm up argon2 so the first measurement is not an outlier.
		await time("warmup@example.com");
		const [known, knownHtml, knownMs] = await time(account.email);
		const [unknown, unknownHtml, unknownMs] = await time(
			"nobody-here@example.com",
		);
		expect(unknown.status).toBe(known.status);
		expect(unknownHtml).toBe(knownHtml);
		// Both paths run one argon2 verification; allow generous jitter.
		expect(unknownMs).toBeGreaterThan(knownMs / 3);
		expect(unknownMs).toBeLessThan(knownMs * 3);
	});

	it("answers a Telegram reset request the same for any identifier", async () => {
		const accounts = repositoryOf(idp);
		const account = await createTestAccount(accounts);
		await accounts.links.setTelegram(account._id, { chatId: "9001" });
		const page = await openLoginPage(idp);
		const forgot = async (identifier: string): Promise<[number, string]> => {
			const response = await page.browser.request(
				`${idp.issuer}/interaction/${page.uid}/forgot/telegram`,
				{ form: { csrf: page.csrf, identifier } },
			);
			return [response.status, comparable(await response.text(), identifier)];
		};
		const before = fake.telegramMessages.length;
		const [knownStatus, knownHtml] = await forgot(account.username);
		const [unknownStatus, unknownHtml] = await forgot("nobody_at_all");
		expect(unknownStatus).toBe(knownStatus);
		expect(unknownHtml).toBe(knownHtml);
		expect(knownHtml).toContain(TELEGRAM_SENT_MESSAGE);
		// The link reached only the real account's chat.
		await expect.poll(() => fake.telegramMessages.length).toBe(before + 1);
		expect(fake.telegramMessages.at(-1)?.chatId).toBe("9001");
	});
});
