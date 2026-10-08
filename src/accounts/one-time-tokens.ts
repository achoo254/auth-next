import { createHash, randomBytes } from "node:crypto";
import type { Collection, Db } from "mongodb";

/**
 * Tokens that act on an account. They are stamped with the account's
 * `securityVersion` and only reachable through AccountTokens, which refuses
 * them once that version moved on (see account-tokens.ts).
 */
export type AccountTokenKind =
	| "telegram-link"
	| "password-reset"
	| "upstream-link-state"
	| "signup-pending"
	| "review-pending"
	| "review-reset";

/** Tokens not tied to an account (yet): OAuth sign-in state, a pending profile. */
export type FreeTokenKind = "upstream-state" | "upstream-pending";

/** What a one-time token is for; a token never works for another kind. */
export type OneTimeTokenKind = AccountTokenKind | FreeTokenKind;

export type TokenData = Record<string, string>;

interface OneTimeTokenDocument {
	/** SHA-256 of kind and token: the token itself is never stored. */
	_id: string;
	kind: OneTimeTokenKind;
	data: TokenData;
	expiresAt: Date;
}

export const ONE_TIME_TOKENS_COLLECTION = "one_time_tokens";

function keyOf(kind: OneTimeTokenKind, token: string): string {
	return createHash("sha256").update(`${kind}\n${token}`).digest("base64url");
}

/** 256 random bits, URL- and Telegram-deep-link-safe (43 chars). */
export function randomToken(): string {
	return randomBytes(32).toString("base64url");
}

/**
 * Storage of short-lived single-use secrets, hashed, with a TTL index.
 * `take` deletes atomically, so two requests racing on one token cannot
 * both succeed. Used directly only by the two token services below.
 */
export class TokenCollection {
	private readonly tokens: Collection<OneTimeTokenDocument>;

	constructor(db: Db) {
		this.tokens = db.collection<OneTimeTokenDocument>(
			ONE_TIME_TOKENS_COLLECTION,
		);
	}

	async put(
		kind: OneTimeTokenKind,
		token: string,
		data: TokenData,
		ttlSeconds: number,
	): Promise<void> {
		await this.tokens.replaceOne(
			{ _id: keyOf(kind, token) },
			{ kind, data, expiresAt: new Date(Date.now() + ttlSeconds * 1000) },
			{ upsert: true },
		);
	}

	/** Reads without consuming; expired tokens read as missing. */
	async peek(
		kind: OneTimeTokenKind,
		token: string,
	): Promise<TokenData | undefined> {
		const document = await this.tokens.findOne({
			_id: keyOf(kind, token),
			kind,
			expiresAt: { $gt: new Date() },
		});
		return document?.data;
	}

	/** Consumes the token: only the first caller gets its data. */
	async take(
		kind: OneTimeTokenKind,
		token: string,
	): Promise<TokenData | undefined> {
		const document = await this.tokens.findOneAndDelete({
			_id: keyOf(kind, token),
			kind,
			expiresAt: { $gt: new Date() },
		});
		return document?.data;
	}

	/** Overwrites some data fields of a live token (expiry unchanged). */
	async update(
		kind: OneTimeTokenKind,
		token: string,
		fields: TokenData,
	): Promise<void> {
		const set = Object.fromEntries(
			Object.entries(fields).map(([key, value]) => [`data.${key}`, value]),
		);
		await this.tokens.updateOne(
			{ _id: keyOf(kind, token), kind },
			{ $set: set },
		);
	}

	async deleteFor(accountId: string, kind?: OneTimeTokenKind): Promise<void> {
		await this.tokens.deleteMany({
			"data.accountId": accountId,
			...(kind ? { kind } : {}),
		});
	}
}

/** Tokens not bound to an account: OAuth sign-in state, pending profiles. */
export class OneTimeTokenStore {
	private readonly collection: TokenCollection;

	constructor(db: Db) {
		this.collection = new TokenCollection(db);
	}

	put(
		kind: FreeTokenKind,
		token: string,
		data: TokenData,
		ttlSeconds: number,
	): Promise<void> {
		return this.collection.put(kind, token, data, ttlSeconds);
	}

	peek(kind: FreeTokenKind, token: string): Promise<TokenData | undefined> {
		return this.collection.peek(kind, token);
	}

	take(kind: FreeTokenKind, token: string): Promise<TokenData | undefined> {
		return this.collection.take(kind, token);
	}

	/**
	 * Drops every token issued for one account, of any kind (link codes,
	 * reset links, OAuth link states...): used when its password changes.
	 */
	revokeAllFor(accountId: string): Promise<void> {
		return this.collection.deleteFor(accountId);
	}
}

export async function ensureOneTimeTokenIndexes(db: Db): Promise<void> {
	const tokens = db.collection(ONE_TIME_TOKENS_COLLECTION);
	await tokens.createIndex(
		{ expiresAt: 1 },
		{ expireAfterSeconds: 0, name: "expiresAt_ttl" },
	);
	await tokens.createIndex({ kind: 1, "data.accountId": 1 });
	await tokens.createIndex({ "data.accountId": 1 });
}
