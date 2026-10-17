import { describe, expect, it } from "vitest";
import { testPage } from "../__tests__/helpers/test-page.js";
import { type ClaimView, renderClaimPage } from "./claim-page.js";
import type { ClaimDocument } from "./tenant-claims.js";
import type { TenantDocument } from "./tenant-registry.js";

const ALICE = { provider: "google" as const, providerId: "g-alice" };

function view(overrides: Partial<ClaimView> = {}): ClaimView {
	return {
		host: "auth.hoandat.com",
		page: testPage("en", "/claim"),
		csrf: "csrf-token",
		hostings: ["hoandat", "self"],
		serviceIp: "203.0.113.65",
		identities: [{ ...ALICE, label: "alice@example.org" }],
		claims: [],
		tenants: [],
		...overrides,
	};
}

function claim(hosting: ClaimDocument["hosting"]): ClaimDocument {
	const now = new Date();
	return {
		_id: "clm_1",
		domain: "own.example.org",
		owner: ALICE,
		accountId: "acc_a",
		txt: "hoandat-auth-claim=abc",
		hosting,
		createdAt: now,
		expiresAt: new Date(now.getTime() + 60_000),
	};
}

describe("/claim with the self-hosted mode (ADR 0007)", () => {
	it("asks where the tenant runs, on this service by default", () => {
		const html = renderClaimPage(view());
		expect(html).toContain('data-id="claim-hosting"');
		expect(html).toMatch(
			/value="hoandat" checked data-id="claim-hosting-hoandat"/,
		);
		expect(html).toContain('data-id="claim-hosting-self"');
	});

	it("does not ask when only one place is offered", () => {
		const html = renderClaimPage(view({ hostings: ["hoandat"] }));
		expect(html).not.toContain('data-id="claim-hosting"');
		expect(html).toContain(
			'<input type="hidden" name="hosting" value="hoandat">',
		);
		expect(renderClaimPage(view({ hostings: [] }))).toContain(
			'data-id="claim-closed"',
		);
	});

	it("asks a self-hosted claim for the TXT record only", () => {
		const self = renderClaimPage(view({ claims: [claim("self")] }));
		expect(self).toContain('data-id="claim-txt-value">hoandat-auth-claim=abc<');
		expect(self).not.toContain('data-id="claim-record-auth"');
		const hosted = renderClaimPage(view({ claims: [claim(undefined)] }));
		expect(hosted).toContain('data-id="claim-record-auth"');
	});

	it("offers no /admin link for a self-hosted tenant", () => {
		const tenant: TenantDocument = {
			_id: "ten_1",
			domain: "own.example.org",
			displayName: "own",
			status: "enrolling",
			owner: ALICE,
			createdAt: new Date(),
		};
		const html = renderClaimPage(view({ tenants: [tenant] }));
		expect(html).toContain('data-id="tenant-status-own.example.org"');
		expect(html).not.toContain('data-id="tenant-admin-own.example.org"');
	});
});
