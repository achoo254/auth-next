import type { Db } from "mongodb";
import type { AccountRepository } from "./account-repository.js";
import {
	type AccountTokenKind,
	TokenCollection,
	type TokenData,
} from "./one-time-tokens.js";
import {
	type AccountDocument,
	type UpstreamProvider,
	isUpstreamProvider,
} from "./user-model.js";

/**
 * The channel a token was delivered through or will act on: a Telegram
 * chat, or a Google/GitHub/Apple account. The token only works while that channel
 * is still linked to the account.
 */
export type TokenChannel =
	| { readonly kind: "telegram"; readonly chatId: string }
	| { readonly kind: UpstreamProvider; readonly providerId: string };

/** Data fields the service reserves on every account token. */
const RESERVED = ["accountId", "securityVersion", "channel"] as const;

export type AccountTokenResult =
	| {
			readonly status: "ok";
			readonly account: AccountDocument;
			/**
			 * The security version the token was checked at. Writes it allows
			 * pass this on (see versioned-write.ts), so a change slipped in
			 * between check and write makes the write fail.
			 */
			readonly version: number;
			/** The issuer's own fields (reserved ones removed). */
			readonly data: Readonly<TokenData>;
	  }
	/** Unknown, expired, or already used. */
	| { readonly status: "missing" }
	/** Issued before a security change, or its channel was unlinked: 410. */
	| { readonly status: "stale" };

export function securityVersionOf(account: AccountDocument): string {
	return String(account.securityVersion ?? 0);
}

function encodeChannel(channel: TokenChannel): string {
	return channel.kind === "telegram"
		? `telegram:${channel.chatId}`
		: `${channel.kind}:${channel.providerId}`;
}

function channelStillLinked(
	account: AccountDocument,
	channel: string,
): boolean {
	const separator = channel.indexOf(":");
	const kind = channel.slice(0, separator);
	const id = channel.slice(separator + 1);
	if (kind === "telegram") return account.telegram?.chatId === id;
	return isUpstreamProvider(kind) && account.providers[kind] === id;
}

/**
 * The invariant, in one place: a token acts on its account only if the
 * account is still active, nothing security-relevant changed since it was
 * issued (same `securityVersion`), and the channel it came through is still
 * linked. Every account token goes through this check.
 */
export function isTokenCurrent(
	account: AccountDocument | undefined,
	data: Readonly<TokenData>,
): account is AccountDocument {
	if (!account || account.disabledAt || account._id !== data.accountId)
		return false;
	if (data.securityVersion !== securityVersionOf(account)) return false;
	return (
		data.channel === undefined || channelStillLinked(account, data.channel)
	);
}

/**
 * Account-bound one-time tokens (Telegram link codes, OAuth link state).
 * Issuing stamps the account's current `securityVersion` (and channel);
 * using one re-checks both, so a token issued before a link/unlink or a
 * reclaimed email stops working.
 */
export class AccountTokens {
	private readonly collection: TokenCollection;

	/** Tokens live in the tenant of `accounts`, like the accounts they act on. */
	constructor(
		db: Db,
		private readonly accounts: AccountRepository,
	) {
		this.collection = new TokenCollection(db, accounts.tenant);
	}

	/** Issues `token`; false (nothing stored) when the account is gone. */
	async issue(
		kind: AccountTokenKind,
		token: string,
		accountId: string,
		data: TokenData,
		ttlSeconds: number,
		channel?: TokenChannel,
	): Promise<boolean> {
		const account = await this.accounts.findActiveById(accountId);
		if (!account) return false;
		await this.collection.put(
			kind,
			token,
			{
				...data,
				accountId,
				securityVersion: securityVersionOf(account),
				...(channel ? { channel: encodeChannel(channel) } : {}),
			},
			ttlSeconds,
		);
		return true;
	}

	peek(kind: AccountTokenKind, token: string): Promise<AccountTokenResult> {
		return this.resolve(this.collection.peek(kind, token));
	}

	/** Consumes the token, current or stale: either way it is used up. */
	take(kind: AccountTokenKind, token: string): Promise<AccountTokenResult> {
		return this.resolve(this.collection.take(kind, token));
	}

	revokeFor(kind: AccountTokenKind, accountId: string): Promise<void> {
		return this.collection.deleteFor(accountId, kind);
	}

	private async resolve(
		pending: Promise<TokenData | undefined>,
	): Promise<AccountTokenResult> {
		const data = await pending;
		if (!data?.accountId) return { status: "missing" };
		const account = await this.accounts.findActiveById(data.accountId);
		if (!isTokenCurrent(account, data)) return { status: "stale" };
		const own = Object.fromEntries(
			Object.entries(data).filter(
				([key]) => !(RESERVED as readonly string[]).includes(key),
			),
		);
		return {
			status: "ok",
			account,
			version: account.securityVersion ?? 0,
			data: own,
		};
	}
}
