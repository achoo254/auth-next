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
		expect(card(html, "github")).toContain("On: people sign in with GitHub.");
		expect(card(html, "google")).toContain(
			"Off. Optional: add it so people can also sign in with Google.",
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
