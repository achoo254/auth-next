import { describe, expect, it } from "vitest";
import {
	renderRemoveAppConfirm,
	renderRevokeOthersConfirm,
} from "../account-portal/account-confirm-page.js";
import {
	type AccountView,
	renderAccountPage,
} from "../account-portal/account-page.js";
import { renderAppsPage } from "../app-directory/apps-page.js";
import type { Locale } from "../i18n/locales.js";
import { renderConsent } from "../interactions/consent-page.js";
import { renderDeviceApproval } from "../interactions/device-verify-page.js";
import { renderErrorPage } from "../interactions/error-page.js";
import { renderLogin, renderSignup } from "../interactions/login-page.js";
import { renderChooseUsername } from "../interactions/upstream-pages.js";
import { renderPrivacyPage } from "../legal/privacy-page.js";
import { testPage } from "./helpers/test-page.js";

const HOST = "auth.example.test";
const NOW = new Date("2026-10-10T01:00:00Z");
const APP_URLS = {
	ISSUER: `https://${HOST}`,
	LOCALMAN_WEB_URL: "https://localman.example.test",
	TUNELO_WEB_URL: "https://tunnel.example.test",
};

function accountView(locale: Locale): AccountView {
	return {
		host: HOST,
		page: testPage(locale, "/account"),
		csrf: "csrf-token",
		account: {
			_id: "acc_1",
			username: "minh_anh",
			email: "minh.anh@example.com",
			emailVerifiedBy: "google",
			providers: { google: "g-1" },
			createdAt: NOW,
		},
		currentSessionUid: "s-1",
		providers: ["google", "github"],
		telegramEnabled: true,
		sessions: [
			{ uid: "s-1", loginAt: NOW, userAgent: "Chrome/1 Mac OS X" },
			{ uid: "s-2", loginAt: NOW },
		],
		devices: [],
		apps: [
			{
				clientId: "mcp-1",
				name: "Claude Code",
				firstParty: false,
				redirectHosts: ["localhost:3000"],
				scopes: ["mock:read"],
				grantIds: ["g1"],
			},
		],
	};
}

/** Every page, rendered in `locale`. */
function pages(locale: Locale): Record<string, string> {
	const page = testPage(locale);
	const view = accountView(locale);
	const app = view.apps[0];
	if (!app) throw new Error("no app");
	const base = { host: HOST, page, csrf: "csrf-token", uid: "uid-1" };
	return {
		login: renderLogin({
			...base,
			providers: ["google", "github"],
			clientName: "Localman",
			forDevice: false,
		}),
		signup: renderSignup({ ...base, providers: ["google"] }),
		consent: renderConsent({
			...base,
			clientName: "Claude Code",
			external: true,
			imitatesFirstParty: false,
			redirectHost: "localhost:3000",
			scopes: ["openid", "mock:read"],
			username: "minh_anh",
		}),
		device: renderDeviceApproval({
			...base,
			clientId: "tunelo-cli",
			params: { device_name: "may-1" },
			deviceInfo: undefined,
			scopes: ["tunnels:open"],
			username: "minh_anh",
		}),
		username: renderChooseUsername({
			...base,
			provider: "google",
			email: "minh.anh@example.com",
			suggestion: "minh_anh",
			reclaiming: true,
		}),
		error: renderErrorPage({ host: HOST, page, message: "x", code: "c" }),
		privacy: renderPrivacyPage(HOST, page),
		apps: renderAppsPage(APP_URLS, page),
		account: renderAccountPage(view),
		confirmApp: renderRemoveAppConfirm({
			...base,
			action: "/account/apps/mcp-1/revoke",
			app,
		}),
		confirmSessions: renderRevokeOthersConfirm({
			...base,
			action: "/account/sessions/revoke-others",
			others: view.sessions.slice(1),
		}),
	};
}

const EXPECTED: Readonly<Record<Locale, readonly string[]>> = {
	en: [
		"Sign in to continue to Localman",
		"Sign in with Google",
		"Remove app access",
		"Apps that use your hoandat account",
	],
	"zh-CN": [
		"登录以继续使用 Localman",
		"使用 Google 登录",
		"移除应用访问权限",
		"使用 hoandat 账号的应用",
	],
	vi: [
		"Đăng nhập để tiếp tục tới Localman",
		"Đăng nhập với Google",
		"Gỡ quyền của ứng dụng",
		"Ứng dụng dùng tài khoản hoandat",
	],
};

describe("every page in every language", () => {
	it.each(["en", "zh-CN", "vi"] as const)("%s", (locale) => {
		const rendered = pages(locale);
		for (const [name, html] of Object.entries(rendered)) {
			expect(html, name).toContain(`<html lang="${locale}">`);
			// No placeholder left unfilled, and the switcher marks this language.
			expect(html, name).not.toMatch(/\{\w+\}/);
			expect(html, name).toMatch(
				new RegExp(`hreflang="${locale}" aria-current="true"`),
			);
		}
		const all = Object.values(rendered).join("\n");
		for (const text of EXPECTED[locale]) expect(all).toContain(text);
	});

	it("shows no Vietnamese on English pages", () => {
		const vietnamese =
			/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
		for (const [name, html] of Object.entries(pages("en"))) {
			// The language switcher names Vietnamese in Vietnamese.
			const text = html.replace(/Tiếng Việt/g, "");
			expect(text, name).not.toMatch(vietnamese);
		}
	});
});
