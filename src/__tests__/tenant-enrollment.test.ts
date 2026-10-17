import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { exportJWK, generateKeyPair } from "jose";
import type { Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { generateSigningJwk } from "../oidc/jwks.js";
import {
	issueEnrollmentBundle,
	localBundleKeys,
	selfHostedIssuer,
	verifyEnrollmentBundle,
} from "../tenants/enrollment-bundle.js";
import { ENROLLMENT_CHALLENGE_PATH } from "../tenants/enrollment-challenge.js";
import {
	parseInstallKey,
	redeemEnrollment,
} from "../tenants/enrollment-redeem.js";
import { createInstallEnrollment } from "../tenants/install-enrollment.js";
import { claimTxtName } from "../tenants/ownership-records.js";
import { isPublicAddress } from "../tenants/public-address.js";
import { SecretKeyring } from "../tenants/secret-keyring.js";
import type { Tenancy } from "../tenants/tenancy.js";
import { TenantClaims } from "../tenants/tenant-claims.js";
import {
	type TenantDocument,
	TenantRegistry,
	ensureTenantRegistryIndexes,
	newTenantId,
} from "../tenants/tenant-registry.js";
import { TenantSecrets } from "../tenants/tenant-secrets.js";
import { openTestDb } from "./helpers/test-accounts.js";

/*
 * Enrollment of a self-hosted install at its gateway (ADR 0007), both
 * sides for real: the install's challenge router listens on a loopback
 * port, and its redemption goes straight to the gateway's redeemEnrollment.
 */

const GATEWAY = "https://auth.hoandat.com";
const DOMAIN = "own.example.org";
const ALICE = { provider: "google" as const, providerId: "g-alice" };
const gatewayJwks = { keys: [await generateSigningJwk()] };
const logger = createLogger("silent");

let db: Db;
let close: () => Promise<void>;
let dir: string;
let txt: Map<string, string>;
/** Where the install under test listens; the gateway's challenge goes there. */
let installOrigin: string | undefined;

function tenancy(): Tenancy {
	return {
		db,
		registry: new TenantRegistry(db),
		claims: new TenantClaims(db),
		secrets: new TenantSecrets(
			db,
			new SecretKeyring([{ kid: "k", key: Buffer.alloc(32, 1) }]),
		),
		resolver: {
			resolveTxt: async (name) => {
				const value = txt.get(name);
				if (value === undefined) {
					throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
				}
				return [[value]];
			},
			resolve4: async () => {
				throw new Error("a self-hosted tenant's hosts are never looked up");
			},
		},
		selfHostedClaims: true,
		maxActive: 0,
		minAvailableMemoryMb: 0,
		blockedDomains: [],
		telegramApiBaseUrl: "https://telegram.test",
		claimUrl: `${GATEWAY}/claim`,
		issuer: GATEWAY,
		signingJwks: gatewayJwks,
		// The install's real challenge endpoint, over loopback in this test.
		fetchChallenge: async (_domain, nonce) => {
			if (!installOrigin) return undefined;
			const url = `${installOrigin}${ENROLLMENT_CHALLENGE_PATH}?nonce=${nonce}`;
			const response = await fetch(url);
			return response.ok ? response.text() : undefined;
		},
		fetch,
		logger,
		availableMemoryMb: () => 0,
		changed: () => undefined,
	};
}

/** The install's HTTP client: the gateway's redeem route, minus HTTP. */
const toGateway: typeof fetch = async (_url, init) => {
	const body: unknown = JSON.parse(String(init?.body));
	const record = typeof body === "object" && body !== null ? body : {};
	const result = await redeemEnrollment(tenancy(), {
		bundle: Reflect.get(record, "bundle"),
		installKey: Reflect.get(record, "install_key"),
	});
	return result.ok
		? Response.json({ status: "self_hosted" })
		: Response.json({ error: result.error }, { status: 409 });
};

async function enrollingTenant(domain = DOMAIN): Promise<TenantDocument> {
	const tenant: TenantDocument = {
		_id: newTenantId(),
		domain,
		displayName: domain,
		status: "enrolling",
		owner: ALICE,
		claimTxt: `hoandat-auth-claim=${domain}`,
		createdAt: new Date(),
		claimedAt: new Date(),
	};
	await new TenantRegistry(db).insert(tenant);
	txt.set(claimTxtName(domain), tenant.claimTxt ?? "");
	return tenant;
}

/** An install of DOMAIN with `bundle`, listening on a loopback port. */
async function startInstall(bundle: string, keyName = "install-key.json") {
	const bundlePath = join(dir, `bundle-${keyName}`);
	await writeFile(bundlePath, bundle);
	const install = await createInstallEnrollment({
		gateway: GATEWAY,
		bundlePath,
		keyPath: join(dir, keyName),
		issuer: selfHostedIssuer(DOMAIN),
		domain: DOMAIN,
		logger,
		fetch: toGateway,
		gatewayKeys: localBundleKeys(gatewayJwks),
	});
	const app = express().use(install.router);
	const server = app.listen(0, "127.0.0.1");
	await new Promise((resolve) => server.once("listening", resolve));
	installOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return {
		install,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

function bundleFor(tenant: TenantDocument): Promise<string> {
	return issueEnrollmentBundle({
		issuer: GATEWAY,
		jwks: gatewayJwks,
		tenant,
		owner: ALICE,
	});
}

beforeAll(async () => {
	({ db, close } = await openTestDb());
	await ensureTenantRegistryIndexes(db);
	dir = await mkdtemp(join(tmpdir(), "enrollment-"));
});

beforeEach(async () => {
	txt = new Map();
	installOrigin = undefined;
	await db.collection("tenants").deleteMany({});
});

afterAll(async () => {
	await close?.();
	await rm(dir, { recursive: true, force: true });
});

describe("enrollment bundle", () => {
	it("is the gateway's, for one install, and carries no secret", async () => {
		const tenant = await enrollingTenant();
		const bundle = await bundleFor(tenant);
		const keys = localBundleKeys(gatewayJwks);
		expect(
			await verifyEnrollmentBundle(bundle, keys, {
				issuer: GATEWAY,
				audience: selfHostedIssuer(DOMAIN),
			}),
		).toEqual({
			tenantId: tenant._id,
			domain: DOMAIN,
			displayName: DOMAIN,
			owner: ALICE,
		});
		const other = localBundleKeys({ keys: [await generateSigningJwk()] });
		expect(
			await verifyEnrollmentBundle(bundle, other, { issuer: GATEWAY }),
		).toBeUndefined();
		expect(
			await verifyEnrollmentBundle(bundle, keys, {
				issuer: GATEWAY,
				audience: selfHostedIssuer("other.example.org"),
			}),
		).toBeUndefined();
		expect(bundle).not.toContain(tenant.claimTxt ?? "-");
	});
});

describe("redeeming a bundle", () => {
	it("makes the tenant self-hosted with the install's key, once", async () => {
		const tenant = await enrollingTenant();
		const { install, close: stop } = await startInstall(
			await bundleFor(tenant),
		);
		try {
			expect(await install.redeem()).toBe(true);
			const after = await new TenantRegistry(db).findById(tenant._id);
			expect(after?.status).toBe("self_hosted");
			expect(after?.installKey?.jwk).not.toHaveProperty("d");
			// Enrolled: the challenge is no longer answered.
			const challenge = await fetch(
				`${installOrigin}${ENROLLMENT_CHALLENGE_PATH}?nonce=${"n".repeat(20)}`,
			);
			expect(challenge.status).toBe(404);
			// The same install retrying is still enrolled; another key is not.
			expect(await install.redeem()).toBe(true);
			expect(
				await redeemEnrollment(tenancy(), {
					bundle: await bundleFor(tenant),
					installKey: await exportJWK(
						(await generateKeyPair("ES256")).publicKey,
					),
				}),
			).toEqual({ ok: false, error: "not-enrolling" });
		} finally {
			await stop();
		}
		expect((await stat(join(dir, "install-key.json"))).mode & 0o777).toBe(
			0o600,
		);
	});

	it("needs the TXT still proven and the challenge answered by the same key", async () => {
		const tenant = await enrollingTenant();
		const bundle = await bundleFor(tenant);
		const installKey = await exportJWK(
			(await generateKeyPair("ES256")).publicKey,
		);
		txt.delete(claimTxtName(DOMAIN));
		expect(await redeemEnrollment(tenancy(), { bundle, installKey })).toEqual({
			ok: false,
			error: "dns-txt",
		});
		txt.set(claimTxtName(DOMAIN), tenant.claimTxt ?? "");
		// Nothing answers the challenge.
		expect(await redeemEnrollment(tenancy(), { bundle, installKey })).toEqual({
			ok: false,
			error: "challenge",
		});
		// An answer signed by a key other than the one presented.
		const { install, close: stop } = await startInstall(bundle, "other.json");
		try {
			expect(await redeemEnrollment(tenancy(), { bundle, installKey })).toEqual(
				{ ok: false, error: "challenge" },
			);
		} finally {
			await stop();
		}
		expect(install.claims.domain).toBe(DOMAIN);
		expect((await new TenantRegistry(db).findById(tenant._id))?.status).toBe(
			"enrolling",
		);
	});

	it("refuses a forged bundle, a private or foreign key, a tenant not enrolling", async () => {
		const tenant = await enrollingTenant();
		const bundle = await bundleFor(tenant);
		const { publicKey, privateKey } = await generateKeyPair("ES256", {
			extractable: true,
		});
		const installKey = await exportJWK(publicKey);
		expect(
			await redeemEnrollment(tenancy(), { bundle: `${bundle}x`, installKey }),
		).toEqual({ ok: false, error: "invalid-bundle" });
		expect(parseInstallKey(await exportJWK(privateKey))).toBeUndefined();
		expect(parseInstallKey({ ...installKey, crv: "P-384" })).toBeUndefined();
		await db
			.collection<TenantDocument>("tenants")
			.updateOne({ _id: tenant._id }, { $set: { status: "active" } });
		expect(await redeemEnrollment(tenancy(), { bundle, installKey })).toEqual({
			ok: false,
			error: "not-enrolling",
		});
	});

	it("does not start an install with a bundle for another domain", async () => {
		const tenant = await enrollingTenant("other.example.org");
		await expect(
			startInstall(await bundleFor(tenant), "x.json"),
		).rejects.toThrow(/no valid bundle/);
	});
});

describe("addresses the gateway may call", () => {
	it.each([
		["127.0.0.1", false],
		["10.1.2.3", false],
		["169.254.169.254", false],
		["192.168.1.1", false],
		["100.64.0.1", false],
		["::1", false],
		["fd00::1", false],
		["fe80::1", false],
		["::ffff:127.0.0.1", false],
		["not-an-ip", false],
		["8.8.8.8", true],
		["2606:4700::1111", true],
	])("%s is public: %s", (address, expected) => {
		expect(isPublicAddress(address)).toBe(expected);
	});
});
