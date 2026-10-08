import { randomUUID } from "node:crypto";
import { type BrowserContext, type Page, expect } from "@playwright/test";
import * as client from "openid-client";
import {
	type FakeProfile,
	type SentTelegramMessage,
	fakeAuthorizeRedirect,
} from "../../src/__tests__/helpers/fake-upstreams.js";
import { E2E_ISSUER, E2E_TOOLS, MCP_CALLBACK } from "./e2e-config.js";

export interface TestUser {
	readonly email: string;
	readonly username: string;
	readonly password: string;
}

export function newUser(): TestUser {
	const id = randomUUID().slice(0, 8);
	return {
		email: `Nguoi.Dung.${id}@Example.com`,
		username: `user_${id}`,
		password: `mat-khau-${id}`,
	};
}

/** On the login page: fill identifier and password, submit. */
export async function logIn(
	page: Page,
	identifier: string,
	password: string,
): Promise<void> {
	await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();
	await page.getByLabel("Email hoặc username").fill(identifier);
	await page.locator('[data-id="input-password"]').fill(password);
	await page.locator('[data-id="login-submit"]').click();
}

/**
 * From the login page: sign up, check the recovery codes page (including
 * the .txt download and the "saved" checkbox), continue. Returns the codes.
 */
export async function signUp(page: Page, user: TestUser): Promise<string[]> {
	await page.locator('[data-id="login-to-signup"]').click();
	await page.getByLabel("Email").fill(user.email);
	await page.getByLabel("Username").fill(user.username);
	await page.getByLabel("Mật khẩu", { exact: true }).fill(user.password);
	await page.getByLabel("Nhập lại mật khẩu").fill(user.password);
	await page.locator('[data-id="signup-submit"]').click();

	const codes = await page
		.locator('[data-id="recovery-codes"] code')
		.allTextContents();
	expect(codes).toHaveLength(8);
	const [download] = await Promise.all([
		page.waitForEvent("download"),
		page.locator('[data-id="recovery-download"]').click(),
	]);
	expect(download.suggestedFilename()).toBe(
		`hoandat-recovery-codes-${user.username}.txt`,
	);

	// The browser refuses to continue until the box is ticked.
	await page.locator('[data-id="recovery-continue"]').click();
	await expect(page.locator('[data-id="recovery-codes"]')).toBeVisible();
	await page.locator('[data-id="recovery-saved"]').check();
	await page.locator('[data-id="recovery-continue"]').click();
	return codes;
}

/** Signs up through /account and ends on the account page, signed in. */
export async function signUpViaAccountPage(
	page: Page,
	user: TestUser,
): Promise<string[]> {
	await page.goto("/account");
	const codes = await signUp(page, user);
	await expect(page.locator('[data-id="account-username"]')).toHaveText(
		`@${user.username}`,
	);
	return codes;
}

/**
 * Plays Google for this browser. Playwright cannot route the target of a
 * redirect, so the IdP's own "start Google sign-in" responses are routed
 * instead: their redirect to Google becomes a redirect straight back to the
 * IdP callback with a code for `profile`. Requests that would still reach
 * Google or GitHub are aborted, so the test never touches the network.
 */
export async function routeGoogle(
	context: BrowserContext,
	profile: FakeProfile,
): Promise<void> {
	await context.route(
		/^https:\/\/(accounts\.google\.com|github\.com)\//,
		(route) => route.abort(),
	);
	await context.route(
		/\/(account\/link|upstream)\/google(\?|$)/,
		async (route) => {
			const response = await route.fetch({ maxRedirects: 0 });
			const location = response.headers().location ?? "";
			if (!location.startsWith("https://accounts.google.com/")) {
				await route.fulfill({ response });
				return;
			}
			await route.fulfill({
				response,
				status: 302,
				headers: {
					...response.headers(),
					location: fakeAuthorizeRedirect(location, profile),
				},
			});
		},
	);
}

/** Telegram messages the fake Bot API has received so far. */
export async function telegramMessages(): Promise<SentTelegramMessage[]> {
	const response = await fetch(`${E2E_TOOLS}/telegram/messages`);
	const body: unknown = await response.json();
	return Array.isArray(body) ? (body as SentTelegramMessage[]) : [];
}

export interface McpClient {
	readonly config: client.Configuration;
	authorizationUrl(): Promise<{
		url: URL;
		checks: client.AuthorizationCodeGrantChecks;
	}>;
}

/** Registers an MCP client through DCR, as a coding agent would. */
export async function registerMcpClient(name: string): Promise<McpClient> {
	const options = { execute: [client.allowInsecureRequests] };
	const registered = await client.dynamicClientRegistration(
		new URL(E2E_ISSUER),
		{
			redirect_uris: [MCP_CALLBACK],
			token_endpoint_auth_method: "none",
			client_name: name,
			scope: "mock:read mock:write",
		},
		client.None(),
		options,
	);
	const config = await client.discovery(
		new URL(E2E_ISSUER),
		registered.clientMetadata().client_id,
		{},
		client.None(),
		options,
	);
	return {
		config,
		async authorizationUrl() {
			const verifier = client.randomPKCECodeVerifier();
			const state = client.randomState();
			const url = client.buildAuthorizationUrl(config, {
				redirect_uri: MCP_CALLBACK,
				scope: "mock:read mock:write",
				resource: "https://localman.hoandat.com/mcp",
				code_challenge: await client.calculatePKCECodeChallenge(verifier),
				code_challenge_method: "S256",
				state,
			});
			return {
				url,
				checks: { pkceCodeVerifier: verifier, expectedState: state },
			};
		},
	};
}

export function tuneloCli(): Promise<client.Configuration> {
	return client.discovery(
		new URL(E2E_ISSUER),
		"tunelo-cli",
		{},
		client.None(),
		{
			execute: [client.allowInsecureRequests],
		},
	);
}
