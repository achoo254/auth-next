import { randomBytes } from "node:crypto";
import { AccountConflictError } from "./account-conflicts.js";
import type { AccountRepository } from "./account-repository.js";
import type { AccountDocument } from "./user-model.js";

const REVIEW_USERNAME = "app_review";
const REVIEW_NAME = "App Review";

export type ReviewAccountResult =
	| { readonly kind: "ok"; readonly account: AccountDocument }
	/** The email belongs to an account the review sign-in must never open. */
	| { readonly kind: "not-review-account" }
	/** The review account is being deleted (ADR 0009). */
	| { readonly kind: "disabled" };

function classify(account: AccountDocument): ReviewAccountResult {
	if (account.reviewLogin !== true) return { kind: "not-review-account" };
	if (account.disabledAt) return { kind: "disabled" };
	return { kind: "ok", account };
}

/** `app_review`, or with a random suffix when someone already has it. */
async function freeUsername(accounts: AccountRepository): Promise<string> {
	if (!(await accounts.usernameTaken(REVIEW_USERNAME))) return REVIEW_USERNAME;
	return `${REVIEW_USERNAME}_${randomBytes(4).toString("hex")}`;
}

/**
 * The account of the review-only sign-in (ADR 0010): created on its first
 * use, with an unverified email (no provider vouched for it) and no linked
 * provider. An account that already holds the email but was not made here
 * is never returned: a password must not open a real person's account.
 */
export async function findOrCreateReviewAccount(
	accounts: AccountRepository,
	email: string,
): Promise<ReviewAccountResult> {
	const existing = await accounts.findByEmail(email);
	if (existing) return classify(existing);
	try {
		const account = await accounts.create({
			username: await freeUsername(accounts),
			email,
			emailVerifiedBy: null,
			providers: {},
			name: REVIEW_NAME,
			reviewLogin: true,
		});
		return { kind: "ok", account };
	} catch (error) {
		if (!(error instanceof AccountConflictError)) throw error;
		// A parallel first sign-in created it (or took the username): read again.
		const raced = await accounts.findByEmail(email);
		if (!raced) throw error;
		return classify(raced);
	}
}
