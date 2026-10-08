import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import type { AccountDocument } from "../accounts/user-model.js";
import { readCookie } from "./form.js";

const MAX_ACCOUNTS = 5;
const LIFETIME_SECONDS = 90 * 24 * 60 * 60;

/**
 * "This browser has signed in to that account before, with its current
 * credentials", as a signed HttpOnly cookie. Such a browser is counted on
 * its own attempt budget instead of the account's (see DEVICE_POLICY), so
 * guessing from elsewhere cannot lock the owner out. The signature covers
 * the account's credential generation: a password reset or change voids
 * every earlier cookie.
 */
export interface DeviceMemory {
	/** Signature of this browser's valid cookie for the account, if any. */
	deviceId(req: Request, account: DeviceAccount): string | undefined;
	remember(req: Request, res: Response, account: DeviceAccount): void;
}

export type DeviceAccount = Pick<
	AccountDocument,
	"_id" | "credentialsChangedAt"
>;

function generationOf(account: DeviceAccount): number {
	return account.credentialsChangedAt?.getTime() ?? 0;
}

interface Entry {
	readonly accountId: string;
	readonly issuedAt: number;
	/** Random per cookie, so each remembered browser has its own budget. */
	readonly nonce: string;
}

export function createDeviceMemory(
	keys: readonly string[],
	secureCookies: boolean,
): DeviceMemory {
	const signingKey = keys[0];
	if (!signingKey) throw new Error("Device memory needs at least one key");
	const cookieName = secureCookies ? "__Host-device" : "device";
	const sign = (key: string, entry: Entry, generation: number): Buffer =>
		createHmac("sha256", key)
			.update(
				`device\n${entry.accountId}\n${entry.issuedAt}\n${entry.nonce}\n${generation}`,
			)
			.digest()
			.subarray(0, 16);

	/** The signature when `raw` is a genuine, unexpired entry for `account`. */
	const validFor = (
		raw: string,
		account: DeviceAccount,
	): string | undefined => {
		const [accountId = "", issued = "", nonce = "", signature = ""] =
			raw.split(".");
		const entry = { accountId, issuedAt: Number(issued), nonce };
		const now = Math.floor(Date.now() / 1000);
		if (accountId !== account._id || !Number.isInteger(entry.issuedAt)) {
			return undefined;
		}
		if (now - entry.issuedAt > LIFETIME_SECONDS) return undefined;
		const received = Buffer.from(signature, "base64url");
		const genuine = keys.some((key) => {
			const expected = sign(key, entry, generationOf(account));
			return (
				received.length === expected.length &&
				timingSafeEqual(received, expected)
			);
		});
		return genuine ? signature : undefined;
	};

	const rawEntries = (req: Request): string[] =>
		(readCookie(req, cookieName) ?? "").split("~").filter(Boolean);

	return {
		deviceId(req, account) {
			for (const raw of rawEntries(req)) {
				const signature = validFor(raw, account);
				if (signature) return signature;
			}
			return undefined;
		},
		remember(req, res, account) {
			const fresh = {
				accountId: account._id,
				issuedAt: Math.floor(Date.now() / 1000),
				nonce: randomBytes(9).toString("base64url"),
			};
			const signature = sign(signingKey, fresh, generationOf(account)).toString(
				"base64url",
			);
			// Other accounts' entries stay (they are checked when used).
			const kept = rawEntries(req).filter(
				(raw) => !raw.startsWith(`${account._id}.`),
			);
			const value = [
				`${fresh.accountId}.${fresh.issuedAt}.${fresh.nonce}.${signature}`,
				...kept,
			]
				.slice(0, MAX_ACCOUNTS)
				.join("~");
			res.cookie(cookieName, value, {
				httpOnly: true,
				sameSite: "lax",
				secure: secureCookies,
				path: "/",
				maxAge: LIFETIME_SECONDS * 1000,
			});
		},
	};
}
