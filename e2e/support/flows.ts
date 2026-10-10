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
	/** The Google account (played by the fake) this user signs in with. */
	readonly googleId: string;
}

export function newUser(): TestUser {
	const id = randomUUID().slice(0, 8);
	return {
		email: `Nguoi.Dung.${id}@Example.com`,
		username: `user_${id}`,
		googleId: `g-${id}`,
	};
}

export function googleProfile(user: TestUser): FakeProfile {
	return { id: user.googleId, email: user.email, emailVerified: true };
}

const AUTHORIZE_URL: Readonly<Record<"google" | "github", string>> = {
	google: "https://accounts.google.com/",
	github: "https://github.com/login/oauth/authorize",
};

/**
 * Plays Google or GitHub for this browser. Playwright cannot route the
 * target of a redirect, so the IdP's own "start sign-in/link" responses are
 * routed instead: their redirect to the provider becomes a redirect straight
 * back to the IdP callback with a code for `profile`. Requests that would
 * still reach Google or GitHub are aborted: the test never touches the
 * network.
 */
export async function routeUpstream(
	context: BrowserContext,
	provider: "google" | "github",
	profile: FakeProfile,
): Promise<void> {
	await context.route(
		/^https:\/\/(accounts\.google\.com|github\.com)\//,
		(route) => route.abort(),
	);
	await context.route(
		new RegExp(`/(account/link|upstream)/${provider}(\\?|$)`),
		async (route) => {
			const response = await route.fetch({ maxRedirects: 0 });
			const location = response.headers().location ?? "";
			if (!location.startsWith(AUTHORIZE_URL[provider])) {
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

/** On the login page: "Đăng nhập với Google" as `user`'s Google account. */
export async function logIn(page: Page, user: TestUser): Promise<void> {
	await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();
	await expect(page.locator('input[type="password"]')).toHaveCount(0);
	await routeUpstream(page.context(), "google", googleProfile(user));
	await page.locator('[data-id="upstream-google"]').click();
}

/**
 * From the login page: sign in with a Google account nobody has yet, which
 * creates the account once a username is chosen.
 */
export async function signUp(page: Page, user: TestUser): Promise<void> {
	await logIn(page, user);
	await expect(
		page.getByRole("heading", { name: "Chọn username" }),
	).toBeVisible();
	await page.getByLabel("Username").fill(user.username);
	await page.locator('[data-id="upstream-signup-submit"]').click();
}

/** Signs up through /account and ends on the account page, signed in. */
export async function signUpViaAccountPage(
	page: Page,
	user: TestUser,
): Promise<void> {
	await page.goto("/account");
	await signUp(page, user);
	await expect(page.locator('[data-id="account-username"]')).toHaveText(
		`@${user.username}`,
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
