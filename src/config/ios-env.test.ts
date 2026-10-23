import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { apnsConfig, partialApnsSettings } from "./ios-env.js";

const dir = mkdtempSync(join(tmpdir(), "apns-key-"));

function keyFile(name: string, pem: string): string {
	const path = join(dir, name);
	writeFileSync(path, pem, { mode: 0o600 });
	return path;
}

const ecKey = keyFile(
	"AuthKey.p8",
	generateKeyPairSync("ec", { namedCurve: "prime256v1" })
		.privateKey.export({ format: "pem", type: "pkcs8" })
		.toString(),
);
const ALL = {
	APNS_KEY_PATH: ecKey,
	APNS_KEY_ID: "KEY1234567",
	APNS_TEAM_ID: "TEAM123456",
	APNS_TOPIC: "com.example.account",
};

describe("APNs settings", () => {
	it("turn push on only with all four", () => {
		expect(apnsConfig(ALL)).toMatchObject({
			keyId: "KEY1234567",
			teamId: "TEAM123456",
			topic: "com.example.account",
		});
		const { APNS_TOPIC: _topic, ...three } = ALL;
		expect(apnsConfig(three)).toBeUndefined();
		expect(partialApnsSettings(three)).toHaveLength(3);
		expect(apnsConfig({})).toBeUndefined();
		expect(partialApnsSettings({})).toEqual([]);
	});

	it("refuse a key file that is not an EC P-256 key, without echoing it", () => {
		const rsa = keyFile(
			"rsa.pem",
			generateKeyPairSync("rsa", { modulusLength: 2048 })
				.privateKey.export({ format: "pem", type: "pkcs8" })
				.toString(),
		);
		expect(() => apnsConfig({ ...ALL, APNS_KEY_PATH: rsa })).toThrow(
			/^APNS_KEY_PATH: must be an APNs auth key/,
		);
		expect(() =>
			apnsConfig({ ...ALL, APNS_KEY_PATH: join(dir, "missing.p8") }),
		).toThrow(/^APNS_KEY_PATH: cannot read/);
	});
});
