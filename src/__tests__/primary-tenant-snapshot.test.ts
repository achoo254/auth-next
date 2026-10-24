import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DICTIONARIES, type MessageKey } from "../i18n/dictionaries.js";
import { LOCALES } from "../i18n/locales.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { cookieConfig } from "../oidc/cookies.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { testPage } from "./helpers/test-page.js";

/**
 * What the hoandat.com tenant shows and serves, recorded before the IdP
 * learned about tenants: the multi-tenant code must reproduce it exactly
 * (texts, discovery, static clients, cookies, public pages).
 */
let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "auto" });
});

afterAll(async () => {
	await idp?.close();
});

/**
 * The test issuer listens on a random port; snapshots name it ISSUER. A
 * stylesheet's version is its content hash, which every CSS edit changes.
 */
function withoutIssuer(text: string): string {
	return text
		.split(idp.issuer)
		.join("ISSUER")
		.split(new URL(idp.issuer).host)
		.join("ISSUER_HOST")
		.replace(/\.css\?v=[0-9a-f]{12}/g, ".css?v=HASH");
}

/**
 * Texts only domain tenants ever showed (claiming a domain, a tenant's
 * /admin, the domain guide, Scribe on tenants): the primary tenant never
 * rendered them, so they are not part of what it must keep showing.
 */
const TENANT_ONLY_NAMESPACES = [
	"admin.",
	"claim.",
	"inactive.",
	"guide.",
	"scribe.",
] as const;
const TENANT_ONLY_KEYS: ReadonlySet<string> = new Set([
	"layout.guide",
	"confirm.delete.owner",
	"privacy.rights.deleteContact",
]);

function isPrimaryText(key: string): boolean {
	return (
		!TENANT_ONLY_KEYS.has(key) &&
		!TENANT_ONLY_NAMESPACES.some((namespace) => key.startsWith(namespace))
	);
}

describe("primary tenant (hoandat.com) is unchanged", () => {
	it.each(LOCALES)("shows the same texts in %s", (locale) => {
		const { i18n } = testPage(locale);
		const keys = (Object.keys(DICTIONARIES[locale]) as MessageKey[]).filter(
			isPrimaryText,
		);
		expect(
			Object.fromEntries(keys.map((key) => [key, i18n.t(key)])),
		).toMatchSnapshot();
	});

	it("serves the same discovery document", async () => {
		const response = await fetch(
			`${idp.issuer}/.well-known/openid-configuration`,
		);
		expect(JSON.parse(withoutIssuer(await response.text()))).toMatchSnapshot();
	});

	it("serves the same static clients", async () => {
		const clients = [];
		for (const clientId of Object.values(STATIC_CLIENT_IDS)) {
			const client = await idp.provider.Client.find(clientId);
			const { client_secret: _secret, ...metadata } = client?.metadata() ?? {};
			clients.push(JSON.parse(withoutIssuer(JSON.stringify(metadata))));
		}
		expect(clients).toMatchSnapshot();
	});

	it("keeps cookie names and attributes (no Domain, same prefixes)", async () => {
		expect(
			cookieConfig("https://auth.hoandat.com", ["k".repeat(32)]).names,
		).toMatchSnapshot();
		const url = new URL(`${idp.issuer}/auth`);
		url.search = new URLSearchParams({
			client_id: STATIC_CLIENT_IDS.accountPortal,
			redirect_uri: `${idp.issuer}/account/callback`,
			response_type: "code",
			scope: "openid",
			code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
			code_challenge_method: "S256",
		}).toString();
		const response = await fetch(url, { redirect: "manual" });
		const cookies = response.headers.getSetCookie().map((cookie) =>
			cookie
				.replace(/=[^;]*/, "=VALUE")
				.replace(/expires=[^;]*/i, "expires=DATE")
				.replace(/(path=\/(?:interaction|auth)\/)[^;]+/, "$1UID"),
		);
		expect(cookies.map(withoutIssuer)).toMatchSnapshot();
	});

	it.each(["/apps", "/privacy"])("renders %s the same way", async (path) => {
		for (const language of ["en", "vi", "zh-CN"]) {
			const response = await fetch(`${idp.issuer}${path}`, {
				headers: { "accept-language": language },
			});
			expect(withoutIssuer(await response.text())).toMatchSnapshot(language);
		}
	});
});
