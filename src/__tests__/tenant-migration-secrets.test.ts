import { generateKeyPairSync } from "node:crypto";
import { exportJWK, generateKeyPair } from "jose";
import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSigningJwk } from "../oidc/jwks.js";
import {
	openTenantSecrets,
	sealTenantSecrets,
} from "../tenants/migration-secrets.js";
import { SecretKeyring } from "../tenants/secret-keyring.js";
import { TenantSecrets } from "../tenants/tenant-secrets.js";
import { openTestDb } from "./helpers/test-accounts.js";

/*
 * Secrets of a tenant moving to its own servers (ADR 0007 §7): opened with
 * this server's keyring, sealed to the install's key, opened there.
 */

const TENANT = { id: "ten_moving", domain: "own.example.org" };

let db: Db;
let close: () => Promise<void>;
let secrets: TenantSecrets;

beforeAll(async () => {
	({ db, close } = await openTestDb());
	secrets = new TenantSecrets(
		db,
		new SecretKeyring([{ kid: "k", key: Buffer.alloc(32, 7) }]),
	);
	const signing = { keys: [await generateSigningJwk()] };
	await secrets.put(TENANT.id, "signing-keys", JSON.stringify(signing));
	await secrets.put(
		TENANT.id,
		"google",
		JSON.stringify({ clientId: "g-id", clientSecret: "g-secret-value" }),
	);
	await secrets.put(
		TENANT.id,
		"telegram",
		JSON.stringify({
			token: "123:bot-token-value",
			username: "own_bot",
			webhookSecret: "w".repeat(40),
		}),
	);
	const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	await secrets.putForProvisioner(
		TENANT.id,
		"dns-token-value",
		publicKey.export({ type: "spki", format: "pem" }).toString(),
	);
});

afterAll(async () => {
	await close?.();
});

async function installKeys() {
	const { publicKey, privateKey } = await generateKeyPair("ECDH-ES+A256KW", {
		crv: "P-256",
		extractable: true,
	});
	return {
		publicJwk: await exportJWK(publicKey),
		privateJwk: await exportJWK(privateKey),
	};
}

describe("a moving tenant's secrets", () => {
	it("reach the install with signing keys and settings, the DNS token never", async () => {
		const { publicJwk, privateJwk } = await installKeys();
		const sealed = await sealTenantSecrets(secrets, TENANT, publicJwk);
		for (const secret of [
			"g-secret-value",
			"bot-token-value",
			"dns-token-value",
		]) {
			expect(sealed).not.toContain(secret);
		}
		const opened = await openTenantSecrets(sealed, privateJwk);
		expect(opened.tenantId).toBe(TENANT.id);
		expect(opened.domain).toBe(TENANT.domain);
		expect(opened.signingKeys.keys).toHaveLength(1);
		expect(opened.settings).toEqual({
			GOOGLE_CLIENT_ID: "g-id",
			GOOGLE_CLIENT_SECRET: "g-secret-value",
			TELEGRAM_BOT_TOKEN: "123:bot-token-value",
			TELEGRAM_BOT_USERNAME: "own_bot",
			TELEGRAM_WEBHOOK_SECRET: "w".repeat(40),
		});
		expect(JSON.stringify(opened)).not.toContain("dns-token-value");
	});

	it("open only with the install's own key, unchanged", async () => {
		const install = await installKeys();
		const other = await installKeys();
		const sealed = await sealTenantSecrets(secrets, TENANT, install.publicJwk);
		await expect(openTenantSecrets(sealed, other.privateJwk)).rejects.toThrow();
		const parts = sealed.split(".");
		parts[3] = `${parts[3]?.slice(0, -2)}AA`;
		await expect(
			openTenantSecrets(parts.join("."), install.privateJwk),
		).rejects.toThrow();
	});

	it("are sealed only to an EC P-256 public key, and need signing keys", async () => {
		const install = await installKeys();
		await expect(
			sealTenantSecrets(secrets, TENANT, install.privateJwk),
		).rejects.toThrow(/public key/);
		await expect(
			sealTenantSecrets(
				secrets,
				{ id: "ten_none", domain: "none.example.org" },
				install.publicJwk,
			),
		).rejects.toThrow(/signing keys/);
	});
});
