import type { Collection, Db } from "mongodb";
import type { AccountProfile, AccountStore } from "../oidc/claims.js";
import { translateConflicts } from "./account-conflicts.js";
import { AccountLinks } from "./account-links.js";
import {
	type AccountDocument,
	type UpstreamProvider,
	accountsCollection,
	newAccountId,
	normalizeEmail,
	normalizeUsername,
	toAccountProfile,
} from "./user-model.js";
import { type GuardedWrite, writeWithVersion } from "./versioned-write.js";

export type NewAccount = Omit<AccountDocument, "_id" | "createdAt">;

/** Data access for accounts; the only module that touches `accounts`. */
export class AccountRepository implements AccountStore {
	private readonly accounts: Collection<AccountDocument>;
	/** Provider, Telegram and email-ownership changes. */
	readonly links: AccountLinks;

	constructor(db: Db) {
		this.accounts = accountsCollection(db);
		this.links = new AccountLinks(this.accounts);
	}

	/** oidc-provider lookup: disabled accounts no longer exist for clients. */
	async findAccount(sub: string): Promise<AccountProfile | undefined> {
		const account = await this.findActiveById(sub);
		return account ? toAccountProfile(account) : undefined;
	}

	async findActiveById(id: string): Promise<AccountDocument | undefined> {
		const account = await this.accounts.findOne({
			_id: id,
			disabledAt: { $exists: false },
		});
		return account ?? undefined;
	}

	/** Email when it contains "@", otherwise username (a leading @ is ignored). */
	async findByIdentifier(
		identifier: string,
	): Promise<AccountDocument | undefined> {
		const filter = identifier.includes("@", 1)
			? { email: normalizeEmail(identifier) }
			: { username: normalizeUsername(identifier) };
		return (await this.accounts.findOne(filter)) ?? undefined;
	}

	async findByEmail(email: string): Promise<AccountDocument | undefined> {
		return (
			(await this.accounts.findOne({ email: normalizeEmail(email) })) ??
			undefined
		);
	}

	async findByProvider(
		provider: UpstreamProvider,
		providerId: string,
	): Promise<AccountDocument | undefined> {
		return (
			(await this.accounts.findOne({
				[`providers.${provider}`]: providerId,
			})) ?? undefined
		);
	}

	/** Username and email are normalised here, whatever the caller passed. */
	async create(input: NewAccount): Promise<AccountDocument> {
		const account: AccountDocument = {
			...input,
			username: normalizeUsername(input.username),
			email:
				input.email === undefined ? undefined : normalizeEmail(input.email),
			_id: newAccountId(),
			createdAt: new Date(),
		};
		// Optional fields left undefined are omitted rather than stored as null.
		await translateConflicts(() =>
			this.accounts.insertOne(account, { ignoreUndefined: true }),
		);
		return account;
	}

	async usernameTaken(username: string): Promise<boolean> {
		const count = await this.accounts.countDocuments(
			{ username: normalizeUsername(username) },
			{ limit: 1 },
		);
		return count > 0;
	}

	/**
	 * New password; also starts a new credential generation (voids device
	 * cookies). `expectedVersion`: only if the account is still at the
	 * security version a token was checked against (see versioned-write.ts).
	 */
	setPassword(
		id: string,
		passwordHash: string,
		expectedVersion?: number,
	): Promise<GuardedWrite> {
		return writeWithVersion(
			this.accounts,
			id,
			expectedVersion,
			{},
			{
				$set: { passwordHash, credentialsChangedAt: new Date() },
				$inc: { securityVersion: 1 },
			},
		);
	}

	/** Starts (after a password reset) or ends the mandatory security review. */
	setSecurityReviewPending(
		id: string,
		pending: boolean,
		expectedVersion?: number,
	): Promise<GuardedWrite> {
		return writeWithVersion(
			this.accounts,
			id,
			expectedVersion,
			{},
			pending
				? {
						$set: { securityReviewPendingSince: new Date() },
						$inc: { securityVersion: 1 },
					}
				: {
						$unset: { securityReviewPendingSince: "" },
						$inc: { securityVersion: 1 },
					},
		);
	}

	async updateName(id: string, name: string | undefined): Promise<void> {
		await this.accounts.updateOne(
			{ _id: id },
			name ? { $set: { name } } : { $unset: { name: "" } },
		);
	}

	/** Removes one code hash; false if another request used it first. */
	async consumeRecoveryCode(id: string, codeHash: string): Promise<boolean> {
		const result = await this.accounts.updateOne(
			{ _id: id, recoveryCodeHashes: codeHash },
			{ $pull: { recoveryCodeHashes: codeHash } },
		);
		return result.modifiedCount === 1;
	}

	replaceRecoveryCodes(
		id: string,
		hashes: readonly string[],
		expectedVersion?: number,
	): Promise<GuardedWrite> {
		return writeWithVersion(
			this.accounts,
			id,
			expectedVersion,
			{},
			{
				$set: {
					recoveryCodeHashes: [...hashes],
					recoveryCodesCreatedAt: new Date(),
				},
				$inc: { securityVersion: 1 },
			},
		);
	}
}
