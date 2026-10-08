import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type UpstreamProfile,
	decideUpstreamLogin,
	linkUpstream,
} from "../accounts/account-linking.js";
import { AccountRepository } from "../accounts/account-repository.js";
import { createTestAccount, openTestDb } from "./helpers/test-accounts.js";

let close: () => Promise<void>;
let accounts: AccountRepository;

beforeAll(async () => {
	let db: Db;
	({ db, close } = await openTestDb());
	accounts = new AccountRepository(db);
});

afterAll(async () => {
	await close?.();
});

describe("account linking rules", () => {
	const profile = (overrides: Partial<UpstreamProfile>): UpstreamProfile => ({
		provider: "google",
		providerId: `g-${Math.random()}`,
		verifiedEmail: "someone@example.com",
		...overrides,
	});

	it("links automatically when both sides verified the email", async () => {
		const account = await createTestAccount(accounts, {
			emailVerifiedBy: "github",
		});
		const google = profile({ verifiedEmail: account.email.toUpperCase() });
		const decision = await decideUpstreamLogin(accounts, google);
		expect(decision).toMatchObject({
			kind: "auto-link",
			account: { _id: account._id },
		});
		await linkUpstream(accounts, account, google);
		expect(await decideUpstreamLogin(accounts, google)).toMatchObject({
			kind: "login",
			account: { _id: account._id },
		});
	});

	it("never links to an unverified email: the verified owner reclaims it", async () => {
		const squatter = await createTestAccount(accounts, {
			email: "Mixed.Case@Example.com",
		});
		expect(squatter.email).toBe("mixed.case@example.com");
		const google = profile({ verifiedEmail: "  MIXED.case@example.COM " });
		const decision = await decideUpstreamLogin(accounts, google);
		expect(decision).toMatchObject({
			kind: "signup",
			email: "mixed.case@example.com",
			reclaimsFrom: { _id: squatter._id },
		});
		const previous = await accounts.links.reclaimEmail(
			"MIXED.CASE@example.com",
		);
		expect(previous?._id).toBe(squatter._id);
		const after = await accounts.findActiveById(squatter._id);
		expect(after?.email).toBeUndefined();
		expect(after?.reclaimedEmail?.email).toBe("mixed.case@example.com");
		// It still signs in by username, and the address is free again.
		expect((await accounts.findByIdentifier(squatter.username))?._id).toBe(
			squatter._id,
		);
		expect(
			await accounts.findByEmail("mixed.case@example.com"),
		).toBeUndefined();
		// A verified email is never reclaimed.
		const owner = await createTestAccount(accounts, {
			emailVerifiedBy: "github",
		});
		expect(await accounts.links.reclaimEmail(owner.email)).toBeUndefined();
	});

	it("verifies the email on an explicit link and forgets it on unlink", async () => {
		const account = await createTestAccount(accounts);
		const google = profile({ verifiedEmail: account.email.toUpperCase() });
		await linkUpstream(accounts, account, google);
		const linked = await accounts.findActiveById(account._id);
		expect(linked?.providers.google).toBe(google.providerId);
		expect(linked?.emailVerifiedBy).toBe("google");
		expect(
			await accounts.links.unlinkProvider(account._id, "google"),
		).toMatchObject({ applied: true });
		const unlinked = await accounts.findActiveById(account._id);
		expect(unlinked?.providers.google).toBeUndefined();
		expect(unlinked?.emailVerifiedBy).toBeNull();
	});

	it("offers sign-up when no account has the email", async () => {
		const decision = await decideUpstreamLogin(
			accounts,
			profile({ verifiedEmail: "brand-new@example.com" }),
		);
		expect(decision).toEqual({
			kind: "signup",
			email: "brand-new@example.com",
		});
	});

	it("refuses a provider account without a verified email", async () => {
		const account = await createTestAccount(accounts, {
			emailVerifiedBy: "google",
		});
		const decision = await decideUpstreamLogin(
			accounts,
			profile({ provider: "github", verifiedEmail: undefined }),
		);
		expect(decision).toEqual({ kind: "rejected", reason: "no-verified-email" });
		expect((await accounts.findActiveById(account._id))?.providers).toEqual({});
	});

	it("never replaces another account of the same provider", async () => {
		const account = await createTestAccount(accounts, {
			emailVerifiedBy: "google",
			providers: { google: "g-original" },
		});
		const decision = await decideUpstreamLogin(
			accounts,
			profile({ providerId: "g-other", verifiedEmail: account.email }),
		);
		expect(decision).toEqual({
			kind: "rejected",
			reason: "other-provider-account",
		});
	});

	it("keeps the email verified on unlink when the other provider verified it too", async () => {
		const account = await createTestAccount(accounts);
		await linkUpstream(
			accounts,
			account,
			profile({ provider: "google", verifiedEmail: account.email }),
		);
		const afterGoogle = await accounts.findActiveById(account._id);
		if (!afterGoogle) throw new Error("account vanished");
		await linkUpstream(
			accounts,
			afterGoogle,
			profile({
				provider: "github",
				verifiedEmail: account.email,
				login: "octo",
			}),
		);
		expect(
			(await accounts.findActiveById(account._id))?.providerDetails?.github,
		).toMatchObject({ email: account.email, login: "octo" });
		await accounts.links.unlinkProvider(account._id, "google");
		expect((await accounts.findActiveById(account._id))?.emailVerifiedBy).toBe(
			"github",
		);

		// GitHub vouching for a different address does not keep it verified.
		const other = await createTestAccount(accounts);
		await linkUpstream(
			accounts,
			other,
			profile({ provider: "google", verifiedEmail: other.email }),
		);
		const linked = await accounts.findActiveById(other._id);
		if (!linked) throw new Error("account vanished");
		await linkUpstream(
			accounts,
			linked,
			profile({ provider: "github", verifiedEmail: "elsewhere@example.com" }),
		);
		await accounts.links.unlinkProvider(other._id, "google");
		expect(
			(await accounts.findActiveById(other._id))?.emailVerifiedBy,
		).toBeNull();
	});
});
