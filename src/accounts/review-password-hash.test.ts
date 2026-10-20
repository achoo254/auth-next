import { describe, expect, it } from "vitest";
import {
	decodeReviewPasswordHash,
	encodeReviewPasswordHash,
	hashReviewPassword,
	verifyReviewPassword,
} from "./review-password-hash.js";

describe("review password hash", () => {
	it("encodes scrypt with its parameters and verifies only the right password", async () => {
		const encoded = await hashReviewPassword("correct horse battery");
		expect(encoded).toMatch(
			/^\$scrypt\$ln=15,r=8,p=1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/,
		);
		expect(encoded).not.toContain("correct");
		const decoded = decodeReviewPasswordHash(`${encoded}\n`);
		expect(encodeReviewPasswordHash(decoded)).toBe(encoded);
		expect(await verifyReviewPassword(decoded, "correct horse battery")).toBe(
			true,
		);
		expect(await verifyReviewPassword(decoded, "correct horse batter")).toBe(
			false,
		);
		expect(await verifyReviewPassword(decoded, "")).toBe(false);
	});

	it("salts every hash", async () => {
		const [a, b] = await Promise.all([
			hashReviewPassword("same password here"),
			hashReviewPassword("same password here"),
		]);
		expect(a).not.toBe(b);
	});

	it("rejects malformed hashes and out-of-range parameters without echoing them", async () => {
		const valid = await hashReviewPassword("correct horse battery");
		const [, , , salt = "", hash = ""] = valid.split("$");
		for (const bad of [
			"",
			"hunter2-plaintext",
			valid.replace("$scrypt$", "$argon2id$"),
			`$scrypt$ln=21,r=8,p=1$${salt}$${hash}`,
			`$scrypt$ln=15,r=64,p=1$${salt}$${hash}`,
			`$scrypt$ln=15,r=8,p=0$${salt}$${hash}`,
			`$scrypt$ln=15,r=8,p=1$${salt}`,
			`$scrypt$ln=15,r=8,p=1$short$${hash}`,
		]) {
			let message = "";
			try {
				decodeReviewPasswordHash(bad);
			} catch (error) {
				message = error instanceof Error ? error.message : String(error);
			}
			expect(message, bad).not.toBe("");
			if (bad) expect(message).not.toContain(bad);
		}
	});
});
