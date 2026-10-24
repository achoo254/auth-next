import { describe, expect, it } from "vitest";
import { testPage } from "../__tests__/helpers/test-page.js";
import { type AdminView, renderAdminPage } from "./admin-page.js";
import type { TenantDocument } from "./tenant-registry.js";

function view(
	status: TenantDocument["status"],
	oauth: AdminView["oauth"],
): AdminView {
	return {
		page: testPage("en", "/admin"),
		csrf: "csrf-token",
		tenant: {
			_id: "ten_1",
			domain: "own.example.org",
			displayName: "own",
			status,
			owner: { provider: "google", providerId: "g-1" },
			createdAt: new Date(),
		},
		guideUrl: "https://auth.example.test/guide/domain",
		oauth,
		dnsConfigured: false,
		dnsAvailable: true,
	};
}

function card(html: string, provider: string): string {
	const start = html.indexOf(`data-id="account-admin-${provider}"`);
	return html.slice(start, html.indexOf("</form>", start));
}

describe("/admin sign-in cards", () => {
	it("say which provider people sign in with once the domain is active", () => {
		const html = renderAdminPage(view("active", { github: "Ov23-client" }));
		expect(card(html, "github")).toContain("People sign in with GitHub.");
		expect(card(html, "github")).toContain(
			'data-id="account-admin-github-state">On<',
		);
		expect(card(html, "google")).toContain(
			"Optional: add it so people can also sign in with Google.",
		);
		expect(card(html, "google")).toContain(
			'data-id="account-admin-google-state">Off<',
		);
		expect(html).not.toContain("Until then nobody can sign in here.");
	});

	it("say nobody can sign in yet while no provider is set", () => {
		const html = renderAdminPage(view("claimed", {}));
		expect(card(html, "google")).toContain(
			"Until then nobody can sign in here.",
		);
	});
});

/** A configured tenant: GitHub on, Google off, Scribe keys in each state. */
function configured(result?: AdminView["result"]): AdminView {
	const updatedAt = new Date("2026-10-16T08:06:00Z");
	return {
		...view("active", { github: "Ov23-client" }),
		result,
		scribe: {
			serviceIp: "203.0.113.10",
			keys: [
				{ vendor: "elevenlabs", hint: "77ab", updatedAt, status: "invalid" },
				{ vendor: "openai", hint: "x9Qa", updatedAt },
			],
		},
	};
}

describe("/admin saved settings and their forms", () => {
	it("folds the form of a saved setting and shows the others directly", () => {
		const html = renderAdminPage(configured());
		expect(html).toContain('data-id="admin-oauth-github-change">');
		expect(html).toContain('data-id="admin-scribe-openai-change">');
		for (const folded of [
			"admin-oauth-google-change",
			"admin-dns-change",
			"admin-telegram-change",
			"admin-scribe-gemini-change",
		]) {
			expect(html).not.toContain(folded);
		}
		expect(html).toContain('id="f-google-client-id"');
		expect(html).toContain('id="f-dns-token"');
		expect(html).toContain('id="f-scribe-gemini"');
	});

	it("opens the form of a key Scribe reported broken", () => {
		const html = renderAdminPage(configured());
		expect(html).toContain('data-id="admin-scribe-elevenlabs-change" open>');
		expect(html).toContain('data-id="account-admin-scribe-state">Off<');
	});

	it("keeps Remove next to each saved provider and key only", () => {
		const html = renderAdminPage(configured());
		expect(html).toContain('data-id="admin-remove-github"');
		expect(html).toContain('data-id="admin-remove-scribe-openai"');
		expect(html).toContain('data-id="admin-remove-scribe-elevenlabs"');
		expect(html).not.toContain('data-id="admin-remove-google"');
		expect(html).not.toContain('data-id="admin-remove-scribe-gemini"');
	});

	it("opens every folded form after a save that failed", () => {
		const html = renderAdminPage(
			configured({ tone: "error", text: "Telegram refused this bot token." }),
		);
		expect(html).toContain('data-id="admin-oauth-github-change" open>');
		expect(html).toContain('data-id="admin-scribe-openai-change" open>');
	});
});
