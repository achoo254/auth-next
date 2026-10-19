import type { Collection, Db } from "mongodb";
import type { AuditOutbox } from "../audit/audit-outbox.js";
import type { Locale } from "../i18n/locales.js";
import type { AccountProfile, AccountStore } from "../oidc/claims.js";
import {
	type TenantFilter,
	type TenantScope,
	inTenant,
	tenantTag,
} from "../tenants/tenant-data.js";
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

export type NewAccount = Omit<
	AccountDocument,
	"_id" | "createdAt" | "tenantId"
>;

/**
 * Data access for the accounts of one tenant; the only module that touches
 * `accounts`. Every query is limited to the tenant, so an account of
 * another tenant does not exist here.
 */
export class AccountRepository implements AccountStore {
	private readonly accounts: Collection<AccountDocument>;
	private readonly scope: TenantFilter;
	/** Provider, Telegram and email-ownership changes. */
	readonly links: AccountLinks;

	/**
	 * `audit` records credential changes made here for Localman's audit log;
	 * it must belong to the same tenant.
	 */
	constructor(
		db: Db,
		readonly tenant: TenantScope,
		readonly audit: AuditOutbox,
	) {
		this.accounts = accountsCollection(db);
		this.scope = inTenant(tenant);
		this.links = new AccountLinks(this.accounts, this.scope, audit);
	}

	/** oidc-provider lookup: disabled accounts no longer exist for clients. */
	async findAccount(sub: string): Promise<AccountProfile | undefined> {
		const account = await this.findActiveById(sub);
		return account ? toAccountProfile(account) : undefined;
	}

	async findActiveById(id: string): Promise<AccountDocument | undefined> {
		const account = await this.accounts.findOne({
			_id: id,
			...this.scope,
			disabledAt: { $exists: false },
		});
		return account ?? undefined;
	}

	async findByEmail(email: string): Promise<AccountDocument | undefined> {
		return (
			(await this.accounts.findOne({
				email: normalizeEmail(email),
				...this.scope,
			})) ?? undefined
		);
	}

	async findByProvider(
		provider: UpstreamProvider,
		providerId: string,
	): Promise<AccountDocument | undefined> {
		return (
			(await this.accounts.findOne({
				[`providers.${provider}`]: providerId,
				...this.scope,
			})) ?? undefined
		);
	}

	/**
	 * Drops the stored revocation token of a provider link, once the
	 * provider said it no longer works (Apple: consent revoked, account
	 * deleted). The link itself stays: only the person unlinks. Returns
	 * whether an account had one.
	 */
	async forgetRevocationToken(
		provider: UpstreamProvider,
		providerId: string,
	): Promise<boolean> {
		const field = `providerDetails.${provider}.revocationToken`;
		const result = await this.accounts.updateOne(
			{
				[`providers.${provider}`]: providerId,
				[field]: { $exists: true },
				...this.scope,
			},
			{ $unset: { [field]: "" } },
		);
		return result.modifiedCount > 0;
	}

	/** Username and email are normalised here, whatever the caller passed. */
	async create(input: NewAccount): Promise<AccountDocument> {
		const account: AccountDocument = {
			...input,
			...tenantTag(this.tenant),
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
			{ username: normalizeUsername(username), ...this.scope },
			{ limit: 1 },
		);
		return count > 0;
	}

	async updateName(id: string, name: string | undefined): Promise<void> {
		await this.accounts.updateOne(
			{ _id: id, ...this.scope },
			name ? { $set: { name } } : { $unset: { name: "" } },
		);
	}

	/**
	 * Remembers the language the Telegram bot should write in. Writes only
	 * while a chat is linked and only when the language differs; returns
	 * whether it wrote. Not a security change: `securityVersion` stays.
	 */
	async updateTelegramLocale(id: string, locale: Locale): Promise<boolean> {
		const result = await this.accounts.updateOne(
			{
				_id: id,
				...this.scope,
				"telegram.chatId": { $type: "string" },
				telegramLocale: { $ne: locale },
			},
			{ $set: { telegramLocale: locale } },
		);
		return result.modifiedCount > 0;
	}
}
