import { CompactEncrypt, type JWK, compactDecrypt, importJWK } from "jose";
import { type SigningJwks, parseSigningJwks } from "../oidc/jwks.js";
import { parseInstallKey } from "./enrollment-redeem.js";
import type { TenantSecrets } from "./tenant-secrets.js";

/**
 * The secrets of a tenant moving to its own servers (ADR 0007 §7), sealed
 * to its install's enrollment key: opened here with this server's keyring,
 * sealed again (JWE, ECDH-ES with AES key wrap) so that only the install
 * can read them. The DNS token is not among them: it is sealed for the
 * provisioner and never left it.
 */

export const MIGRATION_SECRETS_TYPE = "hoandat-tenant-secrets+jwe";
const ALG = "ECDH-ES+A256KW";
const ENC = "A256GCM";

/** What the install needs from a moving tenant's secrets, by setting. */
export interface MigratedSecrets {
	readonly tenantId: string;
	readonly domain: string;
	readonly signingKeys: SigningJwks;
	/** OAuth apps and bot of the tenant, as the install's .env names them. */
	readonly settings: Readonly<Record<string, string>>;
}

function parseJson(value: string | undefined): Record<string, unknown> {
	if (!value) return {};
	const parsed: unknown = JSON.parse(value);
	return typeof parsed === "object" && parsed !== null
		? (parsed as Record<string, unknown>)
		: {};
}

function text(
	record: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The OAuth and bot settings of the tenant's stored integrations. */
function settingsOf(
	google: Record<string, unknown>,
	github: Record<string, unknown>,
	telegram: Record<string, unknown>,
): Record<string, string> {
	const settings: Record<string, string> = {};
	const put = (name: string, value: string | undefined): void => {
		if (value) settings[name] = value;
	};
	put("GOOGLE_CLIENT_ID", text(google, "clientId"));
	put("GOOGLE_CLIENT_SECRET", text(google, "clientSecret"));
	put("GITHUB_CLIENT_ID", text(github, "clientId"));
	put("GITHUB_CLIENT_SECRET", text(github, "clientSecret"));
	// The bot's webhook is https://auth.<domain>/..., the same on the install.
	put("TELEGRAM_BOT_TOKEN", text(telegram, "token"));
	put("TELEGRAM_BOT_USERNAME", text(telegram, "username"));
	put("TELEGRAM_WEBHOOK_SECRET", text(telegram, "webhookSecret"));
	return settings;
}

/** Opens a tenant's secrets here and seals them to its install's public key. */
export async function sealTenantSecrets(
	secrets: TenantSecrets,
	tenant: { readonly id: string; readonly domain: string },
	installPublicKey: unknown,
): Promise<string> {
	const jwk = parseInstallKey(installPublicKey);
	if (!jwk) throw new Error("not an install's public key (EC P-256)");
	const signing = await secrets.get(tenant.id, "signing-keys");
	if (!signing) throw new Error("the tenant has no signing keys");
	const payload = {
		tenantId: tenant.id,
		domain: tenant.domain,
		signingKeys: JSON.parse(signing) as unknown,
		settings: settingsOf(
			parseJson(await secrets.get(tenant.id, "google")),
			parseJson(await secrets.get(tenant.id, "github")),
			parseJson(await secrets.get(tenant.id, "telegram")),
		),
	};
	return new CompactEncrypt(new TextEncoder().encode(JSON.stringify(payload)))
		.setProtectedHeader({ alg: ALG, enc: ENC, cty: MIGRATION_SECRETS_TYPE })
		.encrypt(await importJWK(jwk, ALG));
}

/** Opens the sealed secrets with the install's private enrollment key. */
export async function openTenantSecrets(
	sealed: string,
	installPrivateKey: JWK,
): Promise<MigratedSecrets> {
	const { plaintext, protectedHeader } = await compactDecrypt(
		sealed.trim(),
		await importJWK(installPrivateKey, ALG),
		{ keyManagementAlgorithms: [ALG], contentEncryptionAlgorithms: [ENC] },
	);
	if (protectedHeader.cty !== MIGRATION_SECRETS_TYPE) {
		throw new Error("not a tenant's sealed secrets");
	}
	const payload = parseJson(new TextDecoder().decode(plaintext));
	const tenantId = text(payload, "tenantId");
	const domain = text(payload, "domain");
	const settings = payload.settings;
	if (
		!tenantId ||
		!domain ||
		typeof settings !== "object" ||
		settings === null
	) {
		throw new Error("incomplete sealed secrets");
	}
	return {
		tenantId,
		domain,
		signingKeys: parseSigningJwks(payload.signingKeys),
		settings: Object.fromEntries(
			Object.entries(settings).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		),
	};
}
