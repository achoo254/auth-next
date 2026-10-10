import type { Collection, Db } from "mongodb";
import { AuditOutbox } from "../audit/audit-outbox.js";
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

export type NewAccount = Omit<AccountDocument, "_id" | "createdAt">;

/** Data access for accounts; the only module that touches `accounts`. */
export class AccountRepository implements AccountStore {
	private readonly accounts: Collection<AccountDocument>;
	/** Provider, Telegram and email-ownership changes. */
	readonly links: AccountLinks;

	/** `audit` records credential changes made here for Localman's audit log. */
	constructor(
		db: Db,
		readonly audit: AuditOutbox = new AuditOutbox(db),
	) {
		this.accounts = accountsCollection(db);
		this.links = new AccountLinks(this.accounts, audit);
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

	async updateName(id: string, name: string | undefined): Promise<void> {
		await this.accounts.updateOne(
			{ _id: id },
			name ? { $set: { name } } : { $unset: { name: "" } },
		);
	}
}
