import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OwnershipResolver } from "../tenants/ownership-check.js";
import { sharedFakeUpstreams } from "./helpers/fake-upstreams.js";
import {
	type MultiTenantServer,
	fetchAs,
	startMultiTenantServer,
} from "./helpers/multi-tenant-server.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	type TestAccount,
	createTestAccount,
} from "./helpers/test-accounts.js";
import { type TestBrowser, formField } from "./helpers/test-browser.js";
import type { TestIdp } from "./helpers/test-idp.js";

const IP = "203.0.113.65";
const DOMAIN = "acme.example.org";
const AUTH = `auth.${DOMAIN}`;
const records = new Map<string, string[]>();
const outbound: string[] = [];
let server: MultiTenantServer;
let keyDir: string;
let idp: TestIdp;
let alice: TestAccount;
let browser: TestBrowser;

const none = (): Error =>
	Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
const resolver: OwnershipResolver = {
	resolveTxt: async (name) => {
		const value = records.get(`TXT ${name}`);
		if (!value) throw none();
		return [value];
	},
	resolve4: async (name) => {
		const wildcard = `A *.${name.split(".").slice(1).join(".")}`;
		const value = records.get(`A ${name}`) ?? records.get(wildcard);
		if (!value) throw none();
		return value;
	},
};

/** Cloudflare and Telegram as the admin page talks to them. */
const fakeApis: typeof fetch = async (input, init) => {
	const url = String(input);
	outbound.push(
		`${init?.method ?? "GET"} ${url.replace(/bot[^/]+/, "bot<token>")}`,
	);
	const ok = (result: unknown): Response =>
		Response.json({ success: true, ok: true, result });
	if (url.endsWith("/user/tokens/verify")) return ok({ status: "active" });
	if (url.includes("/zones?name=example.org")) return ok([{ id: "zone1" }]);
	if (url.endsWith("/zones/zone1/dns_records")) return ok({ id: "rec1" });
	if (url.endsWith("/zones/zone1/dns_records/rec1")) return ok({});
	if (url.includes("/setWebhook")) return ok(true);
	return Response.json({ success: false }, { status: 404 });
};

/** A browser-like client of a tenant host: keeps cookies, sends Host. */
class HostClient {
	private readonly cookies = new Map<string, string>();
	constructor(private readonly host: string) {}

	async request(
		path: string,
		form?: Record<string, string>,
	): Promise<Response> {
		const response = await fetchAs(server.origin, this.host, path, {
			method: form ? "POST" : "GET",
			headers: {
				cookie: [...this.cookies]
					.map(([name, value]) => `${name}=${value}`)
					.join("; "),
				...(form
					? { "content-type": "application/x-www-form-urlencoded" }
					: {}),
			},
			body: form ? new URLSearchParams(form).toString() : undefined,
		});
		for (const header of response.headers.getSetCookie()) {
			const [pair = ""] = header.split(";");
			const index = pair.indexOf("=");
			this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
		}
		return response;
	}

	copyCookiesFrom(other: HostClient): void {
		for (const [name, value] of other.cookies) this.cookies.set(name, value);
	}
}

async function claimPage(): Promise<string> {
	return (await browser.request(`${server.origin}/claim`)).text();
}

async function postClaim(
	path: string,
	form: Record<string, string> = {},
): Promise<URL> {
	const csrf = formField(await claimPage(), "csrf");
	const response = await browser.request(`${server.origin}${path}`, {
		form: { csrf, ...form },
	});
	return new URL(response.headers.get("location") ?? "", server.origin);
}

beforeAll(async () => {
	keyDir = await mkdtemp(join(tmpdir(), "provisioner-"));
	const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	await writeFile(
		join(keyDir, "provisioner.pem"),
		publicKey.export({ type: "spki", format: "pem" }),
	);
	server = await startMultiTenantServer(
		{
			SERVICE_IPV4: IP,
			PROVISIONER_PUBLIC_KEY_PATH: join(keyDir, "provisioner.pem"),
		},
		{ resolver, fetch: fakeApis, availableMemoryMb: () => 4_000 },
	);
	const primary = server.serving.primary;
	idp = {
		issuer: server.origin,
		tenant: primary.tenant,
		services: primary.services,
		fake: sharedFakeUpstreams(),
	} as unknown as TestIdp;
	alice = await createTestAccount(primary.services.accounts);
	browser = await signedInBrowser(idp, alice);
});

afterAll(async () => {
	await server?.close();
	await rm(keyDir, { recursive: true, force: true });
});

describe("claiming a domain", () => {
	it("needs a signed-in account and comes back to /claim after signing in", async () => {
		const response = await fetchAs(
			server.origin,
			new URL(server.origin).host,
			"/claim",
		);
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toContain("/auth?");
		expect(response.headers.getSetCookie().join(";")).toContain(
			"portal_return=%2Fclaim",
		);
	});

	it("starts a claim, proves it with DNS and makes the claimant owner", async () => {
		const started = await postClaim("/claim", {
			domain: DOMAIN,
			owner: "google",
		});
		expect(started.searchParams.get("notice")).toBe("started");
		const page = await claimPage();
		const claimId = /data-id="claim-verify-(clm_[\w-]+)"/.exec(page)?.[1] ?? "";
		const txt = /data-id="claim-txt-value">([^<]+)</.exec(page)?.[1] ?? "";
		expect(page).toContain(`_auth-claim.${DOMAIN}`);
		const unproven = await postClaim(`/claim/${claimId}/verify`);
		expect(unproven.searchParams.get("error")).toBe("dns-txt");
		records.set(`TXT _auth-claim.${DOMAIN}`, [txt]);
		for (const host of [
			AUTH,
			`localman.${DOMAIN}`,
			`tunnel.${DOMAIN}`,
			`*.localman.${DOMAIN}`,
			`*.tunnel.${DOMAIN}`,
		]) {
			records.set(`A ${host}`, [IP]);
		}
		const verified = await postClaim(`/claim/${claimId}/verify`);
		expect(verified.searchParams.get("notice")).toBe("verified");
		expect(await server.registry.findByDomain(DOMAIN)).toMatchObject({
			status: "claimed",
			owner: { provider: "google", providerId: alice.providers.google },
		});
		expect(await claimPage()).toContain(`data-id="tenant-admin-${DOMAIN}"`);
	});

	it("serves nothing but /admin until a sign-in provider is set", async () => {
		const client = new HostClient(AUTH);
		expect(
			(await client.request("/.well-known/openid-configuration")).status,
		).toBe(404);
		for (const path of [
			"/account",
			"/apps",
			"/interaction/x",
			"/oauth/google/callback",
			"/telegram/webhook",
			"/me",
		]) {
			expect((await client.request(path)).status, path).toBe(404);
		}
		expect((await client.request("/privacy")).status).toBe(200);
		const token = await fetchAs(server.origin, AUTH, "/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: "grant_type=client_credentials",
		});
		expect(token.status).toBe(404);
		const admin = await client.request("/admin");
		expect(admin.status).toBe(200);
		const html = await admin.text();
		expect(html).toContain('data-id="admin-claim-link"');
		expect(html).not.toContain('data-id="admin-save-name"');
	});
});

describe("tenant admin", () => {
	let owner: HostClient;
	let csrf: string;

	async function adminForm(): Promise<string> {
		const html = await (await owner.request("/admin")).text();
		csrf = formField(html, "csrf");
		return html;
	}

	it("opens only through the owner's one-time link", async () => {
		const tenant = await server.registry.findByDomain(DOMAIN);
		const link = await postClaim(`/claim/tenants/${tenant?._id}/admin`);
		expect(link.host).toBe(AUTH);
		owner = new HostClient(AUTH);
		const handoff = `${link.pathname}${link.search}`;
		expect((await owner.request(handoff)).headers.get("location")).toBe(
			"/admin",
		);
		expect(await adminForm()).toContain('data-id="admin-save-name"');
		// Used once: the same link gives nobody a session.
		const stranger = new HostClient(AUTH);
		await stranger.request(handoff);
		expect(await (await stranger.request("/admin")).text()).not.toContain(
			'data-id="admin-save-name"',
		);
		// Another account cannot get a link for this tenant.
		const bob = await createTestAccount(
			server.serving.primary.services.accounts,
		);
		const bobBrowser = await signedInBrowser(idp, bob);
		const bobCsrf = formField(
			await (await bobBrowser.request(`${server.origin}/claim`)).text(),
			"csrf",
		);
		const refused = await bobBrowser.request(
			`${server.origin}/claim/tenants/${tenant?._id}/admin`,
			{ form: { csrf: bobCsrf } },
		);
		expect(refused.headers.get("location")).toBe("/claim?error=not-found");
	});

	it("activates the tenant once Google is configured, never showing the secret", async () => {
		await adminForm();
		const saved = await owner.request("/admin/oauth/google", {
			csrf,
			clientId: "acme-google-id",
			clientSecret: "acme-google-secret",
		});
		expect(saved.headers.get("location")).toBe("/admin?result=saved");
		expect((await server.registry.findByDomain(DOMAIN))?.status).toBe("active");
		const html = await adminForm();
		expect(html).toContain("acme-google-id");
		expect(html).not.toContain("acme-google-secret");
		const discovery = await (
			await new HostClient(AUTH).request("/.well-known/openid-configuration")
		).json();
		expect(discovery).toMatchObject({ issuer: `https://${AUTH}` });
		const login = await new HostClient(AUTH).request("/apps");
		expect(await login.text()).toContain(`https://localman.${DOMAIN}`);
	});

	it("refuses changes without the session's CSRF token, and the last provider's removal", async () => {
		await owner.request("/admin/name", { displayName: "Hijacked" });
		expect((await server.registry.findByDomain(DOMAIN))?.displayName).not.toBe(
			"Hijacked",
		);
		await adminForm();
		const removed = await owner.request("/admin/oauth/google/remove", { csrf });
		expect(removed.headers.get("location")).toBe("/admin?result=last-provider");
		await adminForm();
		await owner.request("/admin/name", { csrf, displayName: "Acme Corp" });
		const page = await (await new HostClient(AUTH).request("/apps")).text();
		expect(page).toContain("<b>Acme Corp</b>");
	});

	it("keeps a Cloudflare token only after it edited the zone, sealed for the provisioner", async () => {
		await adminForm();
		const saved = await owner.request("/admin/dns", {
			csrf,
			token: "cf-token-value",
		});
		expect(saved.headers.get("location")).toBe("/admin?result=saved");
		expect(outbound).toEqual(
			expect.arrayContaining([
				"POST https://api.cloudflare.com/client/v4/zones/zone1/dns_records",
				"DELETE https://api.cloudflare.com/client/v4/zones/zone1/dns_records/rec1",
			]),
		);
		const tenant = await server.registry.findByDomain(DOMAIN);
		expect(tenant?.certificate?.status).toBe("pending");
		expect(
			await server.secrets.sealedForProvisioner(tenant?._id ?? ""),
		).toBeDefined();
		const html = await adminForm();
		expect(html).toContain('data-id="admin-dns-configured"');
		expect(html).not.toContain("cf-token-value");
	});

	it("connects a Telegram bot by pointing its webhook at the tenant", async () => {
		await adminForm();
		const saved = await owner.request("/admin/telegram", {
			csrf,
			token: "123456:acme-bot-token-abcdefghijk",
			username: "@acme_bot",
		});
		expect(saved.headers.get("location")).toBe("/admin?result=saved");
		expect(
			outbound.some(
				(call) =>
					call.startsWith("POST ") && call.endsWith("/bot<token>/setWebhook"),
			),
		).toBe(true);
		expect(await adminForm()).toContain("@acme_bot");
	});

	it("does not open another tenant's admin with this session, even of the same owner", async () => {
		const acme = await server.registry.findByDomain(DOMAIN);
		const beta = await server.addTenant("beta.example.org", "claimed");
		await server.db
			.collection("tenants")
			.updateOne({ _id: beta._id as never }, { $set: { owner: acme?.owner } });
		const elsewhere = new HostClient("auth.beta.example.org");
		elsewhere.copyCookiesFrom(owner);
		const html = await (await elsewhere.request("/admin")).text();
		expect(html).toContain('data-id="admin-claim-link"');
		expect(html).not.toContain('data-id="admin-save-name"');
	});

	it("ignores unknown result and error codes in the query", async () => {
		expect((await owner.request("/admin?result=constructor")).status).toBe(200);
		expect(
			(await browser.request(`${server.origin}/claim?error=toString`)).status,
		).toBe(200);
		expect(
			(await browser.request(`${server.origin}/claim?notice=__proto__`)).status,
		).toBe(200);
	});

	it("refuses a display name with control or invisible characters", async () => {
		await adminForm();
		const saved = await owner.request("/admin/name", {
			csrf,
			displayName: "Acme\u202Egro",
		});
		expect(saved.headers.get("location")).toBe("/admin?result=invalid");
	});
});
