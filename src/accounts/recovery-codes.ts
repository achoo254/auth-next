import { randomInt } from "node:crypto";
import {
	burnPasswordCheck,
	hashSecret,
	verifySecret,
} from "./password-hasher.js";

export const RECOVERY_CODE_COUNT = 8;

/** No 0/o, 1/l/i: codes are read off paper and typed back in. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const GROUP = 4;

function randomGroup(): string {
	let out = "";
	for (let i = 0; i < GROUP; i += 1)
		out += ALPHABET[randomInt(ALPHABET.length)];
	return out;
}

export interface RecoveryCodeSet {
	/** Shown to the user exactly once, never stored. */
	readonly codes: readonly string[];
	readonly hashes: readonly string[];
}

/** Eight fresh `xxxx-xxxx` codes and their argon2id hashes. */
export async function generateRecoveryCodes(): Promise<RecoveryCodeSet> {
	const codes = Array.from(
		{ length: RECOVERY_CODE_COUNT },
		() => `${randomGroup()}-${randomGroup()}`,
	);
	const hashes = await Promise.all(codes.map((code) => hashSecret(code)));
	return { codes, hashes };
}

/** Accepts the code with any case, spaces or dashes; undefined if malformed. */
export function normalizeRecoveryCode(input: string): string | undefined {
	const compact = input.toLowerCase().replace(/[\s-]/g, "");
	if (compact.length !== GROUP * 2) return undefined;
	if (![...compact].every((char) => ALPHABET.includes(char))) return undefined;
	return `${compact.slice(0, GROUP)}-${compact.slice(GROUP)}`;
}

/**
 * The stored hash matching `input`, if any. The caller removes exactly that
 * hash (atomically) so each code works once. Always spends eight argon2
 * verifications, padding with throwaway ones, so the response time does not
 * tell how many codes an account has left or whether it exists at all.
 */
export async function findRecoveryCodeHash(
	hashes: readonly string[],
	input: string,
): Promise<string | undefined> {
	const code = normalizeRecoveryCode(input) ?? input;
	const padding = Math.max(0, RECOVERY_CODE_COUNT - hashes.length);
	const [matches] = await Promise.all([
		Promise.all(hashes.map((stored) => verifySecret(stored, code))),
		Promise.all(Array.from({ length: padding }, () => burnPasswordCheck(code))),
	]);
	return hashes.find((_stored, index) => matches[index]);
}

/** Contents of the downloadable .txt file. */
export function recoveryCodesText(
	username: string,
	codes: readonly string[],
): string {
	return [
		`Mã khôi phục tài khoản hoandat (@${username})`,
		"Mỗi mã dùng được một lần để đặt lại mật khẩu. Cất ở nơi an toàn.",
		"",
		...codes,
		"",
	].join("\n");
}
