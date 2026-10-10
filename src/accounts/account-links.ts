import type { Collection } from "mongodb";
import type { LinkedMethod } from "../audit/audit-events.js";
import type { AuditOutbox } from "../audit/audit-outbox.js";
import {
	type AccountDocument,
	type ProviderDetail,
	type UpstreamProvider,
	normalizeEmail,
} from "./user-model.js";
import { type GuardedWrite, writeWithVersion } from "./versioned-write.js";

/** A provider account being linked, as the provider described it. */
export interface ProviderLink {
	readonly provider: UpstreamProvider;
	readonly providerId: string;
	readonly verifiedEmail?: string;
	/** GitHub login. */
	readonly login?: string;
}

/** What is stored about a link, shown on /account. */
export function providerDetail(link: ProviderLink): ProviderDetail {
	const detail: ProviderDetail = { linkedAt: new Date() };
	if (link.verifiedEmail) detail.email = normalizeEmail(link.verifiedEmail);
	if (link.login) detail.login = link.login;
	return detail;
}

/**
 * Changes to who vouches for an account and how to reach it: Google/GitHub
 * links, the Telegram chat, and handing an unverified email to its proven
 * owner. Reached as `AccountRepository.links`.
 */
export class AccountLinks {
	constructor(
		private readonly accounts: Collection<AccountDocument>,
		private readonly audit: AuditOutbox,
	) {}

	/** Records an applied (un)link for the audit log; returns the write. */
	private async audited(
		id: string,
		change: "method.linked" | "method.unlinked",
		method: LinkedMethod,
		write: Promise<GuardedWrite>,
	): Promise<GuardedWrite> {
		const result = await write;
		if (result.applied) await this.audit.record(change, id, { method });
		return result;
	}

	/**
	 * Links a provider account and records what the provider said (its
	 * verified email, GitHub login). When it vouches for the same email the
	 * account uses, the email becomes verified by that provider. With
	 * `expectedVersion`, only if the account is still at that version.
	 */
	linkProvider(
		account: AccountDocument,
		link: ProviderLink,
		expectedVersion?: number,
	): Promise<GuardedWrite> {
		const email = link.verifiedEmail
			? normalizeEmail(link.verifiedEmail)
			: undefined;
		const verifies =
			account.emailVerifiedBy === null &&
			account.email !== undefined &&
			email === account.email;
		const write = writeWithVersion(
			this.accounts,
			account._id,
			expectedVersion,
			{},
			{
				$set: {
					[`providers.${link.provider}`]: link.providerId,
					[`providerDetails.${link.provider}`]: providerDetail(link),
					...(verifies ? { emailVerifiedBy: link.provider } : {}),
				},
				$inc: { securityVersion: 1 },
			},
		);
		return this.audited(account._id, "method.linked", link.provider, write);
	}

	/**
	 * Unlinks a provider unless it is the last way to sign in: the write
	 * requires the other provider to be linked, so racing unlinks cannot
	 * leave an account without any login method. The email stays verified
	 * only if the other linked provider verified the same address. The new
	 * `emailVerifiedBy` is computed from a read, so the write is conditioned
	 * on the version of that read (or on `expectedVersion`, if given).
	 */
	async unlinkProvider(
		id: string,
		provider: UpstreamProvider,
		expectedVersion?: number,
	): Promise<GuardedWrite> {
		const current = await this.accounts.findOne({ _id: id });
		if (!current) return { applied: false, stale: false };
		const readVersion = current.securityVersion ?? 0;
		if (expectedVersion !== undefined && readVersion !== expectedVersion) {
			return { applied: false, stale: true };
		}
		const other = provider === "google" ? "github" : "google";
		const otherVouches =
			current.providers[other] !== undefined &&
			current.email !== undefined &&
			current.providerDetails?.[other]?.email === current.email;
		const emailVerifiedBy =
			current.emailVerifiedBy === provider
				? otherVouches
					? other
					: null
				: current.emailVerifiedBy;
		const write = writeWithVersion(
			this.accounts,
			id,
			readVersion,
			{
				[`providers.${provider}`]: { $type: "string" },
				[`providers.${other}`]: { $type: "string" },
			},
			{
				$unset: {
					[`providers.${provider}`]: "",
					[`providerDetails.${provider}`]: "",
				},
				$set: { emailVerifiedBy },
				$inc: { securityVersion: 1 },
			},
		);
		return this.audited(id, "method.unlinked", provider, write);
	}

	/**
	 * Takes an unverified email away from the account holding it, because a
	 * provider has just proved someone else owns it. Returns that account as
	 * it was, or undefined when no unverified account holds the email.
	 */
	async reclaimEmail(email: string): Promise<AccountDocument | undefined> {
		const address = normalizeEmail(email);
		const previous = await this.accounts.findOneAndUpdate(
			{ email: address, emailVerifiedBy: null },
			{
				$unset: { email: "" },
				$set: { reclaimedEmail: { email: address, at: new Date() } },
				$inc: { securityVersion: 1 },
			},
			{ returnDocument: "before" },
		);
		if (!previous) return undefined;
		await this.audit.record("email.reclaimed", previous._id, {});
		return previous;
	}

	setTelegram(
		id: string,
		chat: { chatId: string; username?: string; name?: string },
		expectedVersion?: number,
	): Promise<GuardedWrite> {
		const write = writeWithVersion(
			this.accounts,
			id,
			expectedVersion,
			{},
			{
				$set: { telegram: { ...chat, linkedAt: new Date() } },
				$inc: { securityVersion: 1 },
			},
		);
		return this.audited(id, "method.linked", "telegram", write);
	}

	unsetTelegram(id: string, expectedVersion?: number): Promise<GuardedWrite> {
		const write = writeWithVersion(
			this.accounts,
			id,
			expectedVersion,
			{},
			{
				$unset: { telegram: "" },
				$inc: { securityVersion: 1 },
			},
		);
		return this.audited(id, "method.unlinked", "telegram", write);
	}
}
