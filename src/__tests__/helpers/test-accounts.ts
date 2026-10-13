import { randomUUID } from "node:crypto";
import { type Db, MongoClient } from "mongodb";
import * as client from "openid-client";
import { inject } from "vitest";
import type { AccountRepository } from "../../accounts/account-repository.js";
import type {
	AccountDocument,
	UpstreamProvider,
} from "../../accounts/user-model.js";
import { STATIC_CLIENT_IDS } from "../../oidc/clients.js";
import { ensureAccountLayerIndexes } from "../../services.js";
import { discoverClient } from "./flows.js";
import { TestBrowser, formField } from "./test-browser.js";
import {
	LOCALMAN_WEB_SECRET,
	type TestIdp,
	localmanCallbackOf,
} from "./test-idp.js";

/** A fresh database on the shared mongod, with the account indexes. */
export async function openTestDb(): Promise<{
	db: Db;
	close(): Promise<void>;
}> {
	const url = `${inject("mongoUri").replace(/\/$/, "")}/accounts_${randomUUID().slice(0, 8)}`;
	const mongo = new MongoClient(url);
	await mongo.connect();
	const db = mongo.db();
	await ensureAccountLayerIndexes(db);
	return {
		db,
		close: async () => {
			await db.dropDatabase();
			await mongo.close();
		},
	};
}

let counter = 0;

/** Test accounts always have an email. */
export type TestAccount = AccountDocument & { email: string };

/**
 * Creates an account; unique username/email per call. By default it has a
 * Google account linked (its id is unique too), so it can sign in.
 */
export async function createTestAccount(
	accounts: AccountRepository,
	overrides: {
		username?: string;
		email?: string;
		emailVerifiedBy?: UpstreamProvider | null;
		providers?: AccountDocument["providers"];
	} = {},
): Promise<TestAccount> {
	counter += 1;
	const email =
		overrides.email ?? `user${counter}.${randomUUID().slice(0, 6)}@example.com`;
	const account = await accounts.create({
		username:
			overrides.username ?? `user_${counter}_${randomUUID().slice(0, 6)}`,
		email,
		emailVerifiedBy: overrides.emailVerifiedBy ?? null,
		providers: overrides.providers ?? {
			google: `g-${counter}-${randomUUID().slice(0, 8)}`,
		},
	});
	return { ...account, email: account.email ?? email };
}

export function repositoryOf(idp: TestIdp): AccountRepository {
	return idp.services.accounts;
}

export interface LoginPage {
	readonly browser: TestBrowser;
	readonly uid: string;
	readonly csrf: string;
	readonly html: string;
}

/**
 * Starts a localman-web authorization (with `extra` parameters such as
 * ui_locales) and stops on the IdP login page.
 */
export async function openLoginPage(
	idp: TestIdp,
	browser = new TestBrowser(),
	extra: Readonly<Record<string, string>> = {},
): Promise<LoginPage> {
	const config = await discoverClient(
		idp,
		STATIC_CLIENT_IDS.localmanWeb,
		client.ClientSecretBasic(LOCALMAN_WEB_SECRET),
	);
	const callback = localmanCallbackOf(idp);
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: callback,
		scope: "openid profile email",
		code_challenge: await client.calculatePKCECodeChallenge(
			client.randomPKCECodeVerifier(),
		),
		code_challenge_method: "S256",
		...extra,
	});
	const { response } = await browser.navigate(url, {}, callback);
	const html = await response.text();
	const uid = /\/interaction\/([\w-]+)/.exec(response.url)?.[1];
	if (!uid) throw new Error(`Not on an interaction page: ${response.url}`);
	return { browser, uid, csrf: formField(html, "csrf"), html };
}

/** Posts a form and follows the redirects (see TestBrowser.navigate). */
export function submitForm(
	browser: TestBrowser,
	url: string,
	form: Record<string, string>,
	stopAt?: string,
): Promise<{ response: Response; location?: URL }> {
	return browser.navigate(url, { form }, stopAt);
}
