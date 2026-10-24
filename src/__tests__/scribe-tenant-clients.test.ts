import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildScribeClients } from "../oidc/scribe-clients.js";
import { derivedClientSecret } from "../tenants/app-client-secrets.js";
import type { TenantDocument } from "../tenants/tenant-registry.js";
import { tenantFromDocument } from "../tenants/tenant-runtime.js";
import { looksLikeAppHost } from "../tenants/tenant.js";
import {
	type MultiTenantServer,
	getAs,
	startMultiTenantServer,
} from "./helpers/multi-tenant-server.js";

/*
 * scribe-web on a registry tenant (ADR 0012): exactly one web client,
 * only while SCRIBE_TENANTS is on and the tenant turned Scribe on.
 */

/**
 * Fixed vector of a registry tenant's scribe-web secret, shared with
 * Scribe's tests: base64url(HMAC-SHA256(appClientKey(master, "scribe-web"),
 * tenantId)), where appClientKey = base64url(HMAC-SHA256(master,
 * "app-client-key\nscribe-web")).
 */
const VECTOR = {
	master: "scribe-vector-master-key-0123456789abcdef",
	appKey: "VbUBiAD6L3K8pOUba5CoidyP18e3ns-lA2HaVmFcsoU",
	tenantId: "ten_vectorTenant0001",
	secret: "agpXVXYsBzukgRNoTqoTyMlL1VvG__WSui_Pl-Y6wTc",
};

const DOCUMENT: TenantDocument = {
	_id: VECTOR.tenantId,
	domain: "acme.example.org",
	displayName: "acme",
	status: "active",
	scribe: { enabledAt: new Date() },
	createdAt: new Date(),
};

describe("scribe-web of a registry tenant", () => {
	it("derives its secret from the scribe-web app key", () => {
		expect(
			derivedClientSecret(VECTOR.master, VECTOR.tenantId, "scribe-web"),
		).toBe(VECTOR.secret);
	});

	it("is the web client alone, at scribe.<domain> with back-channel logout", () => {
		const tenant = tenantFromDocument(DOCUMENT, true);
		expect(tenant.webApps.scribe).toBe("https://scribe.acme.example.org");
		const clients = buildScribeClients(tenant, undefined, VECTOR.secret);
		expect(clients).toEqual([
			expect.objectContaining({
				client_id: "scribe-web",
				client_secret: VECTOR.secret,
				token_endpoint_auth_method: "client_secret_basic",
				redirect_uris: ["https://scribe.acme.example.org/api/auth/callback"],
				post_logout_redirect_uris: ["https://scribe.acme.example.org/"],
				backchannel_logout_uri:
					"https://scribe.acme.example.org/api/auth/backchannel-logout",
				backchannel_logout_session_required: true,
			}),
		]);
	});

	it("does not exist with Scribe on tenants off or not turned on", () => {
		const off = tenantFromDocument(DOCUMENT, false);
		expect(off.webApps.scribe).toBeUndefined();
		expect(buildScribeClients(off, undefined, VECTOR.secret)).toEqual([]);
		const { scribe: _scribe, ...notOn } = DOCUMENT;
		const unused = tenantFromDocument(notOn, true);
		expect(unused.webApps.scribe).toBeUndefined();
		expect(buildScribeClients(unused, undefined, VECTOR.secret)).toEqual([]);
	});

	it("makes scribe.<domain> an app host, never a tenant domain", () => {
		expect(looksLikeAppHost("scribe.example.com")).toBe(true);
	});
});

describe("a registry tenant turning Scribe on and off", () => {
	let server: MultiTenantServer;
	let acme: TenantDocument;
	const host = "auth.acme.example.org";

	beforeAll(async () => {
		server = await startMultiTenantServer({ SCRIBE_TENANTS: "true" });
		acme = await server.addTenant("acme.example.org");
	});

	afterAll(async () => {
		await server?.close();
	});

	/** An authorization request of scribe-web: 303 when the client exists. */
	async function authorize(): Promise<number> {
		const query = new URLSearchParams({
			client_id: "scribe-web",
			redirect_uri: "https://scribe.acme.example.org/api/auth/callback",
			response_type: "code",
			scope: "openid",
			code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
			code_challenge_method: "S256",
		});
		return (await getAs(server, host, `/auth?${query}`)).status;
	}

	const apps = async (): Promise<string> =>
		(await getAs(server, host, "/apps")).text();

	it("gets scribe-web and a Scribe entry on /apps once turned on", async () => {
		expect(await authorize()).toBe(400);
		expect(await apps()).not.toContain("https://scribe.acme.example.org");
		await server.registry.setScribeEnabled(acme._id, true);
		expect(await authorize()).toBe(303);
		expect(await apps()).toContain('href="https://scribe.acme.example.org"');
	});

	it("loses them once turned off", async () => {
		await server.registry.setScribeEnabled(acme._id, false);
		expect(await authorize()).toBe(400);
		expect(await apps()).not.toContain("https://scribe.acme.example.org");
	});
});
