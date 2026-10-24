import { randomBytes } from "node:crypto";
import type { TenantOAuthProvider } from "../accounts/user-model.js";
import { TENANT_OAUTH_PROVIDERS } from "../accounts/user-model.js";
import type { TenantSetting } from "../audit/audit-events.js";
import { AuditOutbox } from "../audit/audit-outbox.js";
import { ownerSubject } from "./claim-service.js";
import { checkCloudflareToken } from "./cloudflare-token.js";
import type { Tenancy } from "./tenancy.js";
import type { TenantDocument } from "./tenant-registry.js";

/** Outcome of saving a setting; errors map to messages on /admin. */
export type SettingResult =
	| "saved"
	| "invalid"
	| "last-provider"
	| "cloudflare-invalid"
	| "cloudflare-no-zone"
	| "cloudflare-no-dns-edit"
	| "cloudflare-unreachable"
	| "dns-unavailable"
	| "telegram-refused"
	| "scribe-key-invalid"
	| "scribe-key-no-credit"
	| "scribe-key-unreachable";

/** OAuth apps the tenant configured (no secret, just which ones). */
export async function configuredProviders(
	tenancy: Tenancy,
	tenantId: string,
): Promise<TenantOAuthProvider[]> {
	const present = await Promise.all(
		TENANT_OAUTH_PROVIDERS.map((provider) =>
			tenancy.secrets.has(tenantId, provider),
		),
	);
	return TENANT_OAUTH_PROVIDERS.filter((_, index) => present[index]);
}

/**
 * After a change: record it (setting name only), activate a claimed tenant
 * once it has an owner and a sign-in provider, and drop its runtime so the
 * next request builds it with the new settings.
 */
export async function applied(
	tenancy: Tenancy,
	tenant: TenantDocument,
	setting: TenantSetting,
): Promise<SettingResult> {
	if (tenant.owner) {
		await new AuditOutbox(
			tenancy.db,
			{ id: tenant._id },
			tenancy.logger,
		).record("tenant.configured", ownerSubject(tenant.owner), { setting });
	}
	const providers = await configuredProviders(tenancy, tenant._id);
	if (tenant.status === "claimed" && tenant.owner && providers.length > 0) {
		await tenancy.registry.activateIfClaimed(tenant._id);
	}
	tenancy.changed(tenant._id);
	return "saved";
}

const PRINTABLE = /^[\x21-\x7e]+$/;

export async function saveDisplayName(
	tenancy: Tenancy,
	tenant: TenantDocument,
	name: string,
): Promise<SettingResult> {
	const displayName = name.trim().replace(/\s+/g, " ");
	// No control, bidi or zero-width characters: the name is shown on every
	// page and as the account portal's client name.
	if (/[\p{Cc}\p{Cf}]/u.test(displayName)) return "invalid";
	if (displayName.length === 0 || displayName.length > 40) return "invalid";
	await tenancy.registry.update(tenant._id, { displayName });
	return applied(tenancy, tenant, "display-name");
}

/** Stores the tenant's own Google or GitHub OAuth app. */
export async function saveOAuthApp(
	tenancy: Tenancy,
	tenant: TenantDocument,
	provider: TenantOAuthProvider,
	clientId: string,
	clientSecret: string,
): Promise<SettingResult> {
	const id = clientId.trim();
	const secret = clientSecret.trim();
	if (!PRINTABLE.test(id) || !PRINTABLE.test(secret)) return "invalid";
	if (id.length > 200 || secret.length > 200) return "invalid";
	await tenancy.secrets.put(
		tenant._id,
		provider,
		JSON.stringify({ clientId: id, clientSecret: secret }),
	);
	return applied(tenancy, tenant, provider);
}

/** Removes a provider, never the last one of an active tenant (no way in). */
export async function removeOAuthApp(
	tenancy: Tenancy,
	tenant: TenantDocument,
	provider: TenantOAuthProvider,
): Promise<SettingResult> {
	const providers = await configuredProviders(tenancy, tenant._id);
	const others = providers.filter((name) => name !== provider);
	if (tenant.status === "active" && others.length === 0) return "last-provider";
	await tenancy.secrets.remove(tenant._id, provider);
	return applied(tenancy, tenant, provider);
}

/**
 * Keeps the Cloudflare token for wildcard certificates (DNS-01), once it
 * proved it can edit DNS of the tenant's zone. Sealed for the provisioner:
 * the IdP cannot read it back. Certificates are queued again.
 */
export async function saveCloudflareToken(
	tenancy: Tenancy,
	tenant: TenantDocument,
	token: string,
): Promise<SettingResult> {
	const value = token.trim();
	if (!PRINTABLE.test(value) || value.length > 200) return "invalid";
	const publicKey = tenancy.provisionerPublicKey;
	if (!publicKey) return "dns-unavailable";
	const check = await checkCloudflareToken(tenancy.fetch, value, tenant.domain);
	if (check !== "ok") return `cloudflare-${check}`;
	await tenancy.secrets.putForProvisioner(tenant._id, value, publicKey);
	// An issued certificate gets the wildcard (or the new token) on the next
	// pass; a failing one keeps its backoff, so saving again and again never
	// hammers Let's Encrypt.
	const status = tenant.certificate?.status;
	if (status === undefined || status === "issued") {
		await tenancy.registry.setCertificate(tenant._id, {
			status: "pending",
			attempts: 0,
		});
	}
	return applied(tenancy, tenant, "dns-cloudflare");
}

const BOT_TOKEN = /^\d+:[\w-]{20,}$/;
const BOT_USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

/**
 * Connects the owner's Telegram bot: its webhook is pointed at the
 * tenant's IdP with a fresh secret, then the bot is kept.
 */
export async function saveTelegramBot(
	tenancy: Tenancy,
	tenant: TenantDocument,
	token: string,
	username: string,
): Promise<SettingResult> {
	const botToken = token.trim();
	const botUsername = username.trim().replace(/^@/, "");
	if (!BOT_TOKEN.test(botToken) || !BOT_USERNAME.test(botUsername)) {
		return "invalid";
	}
	const webhookSecret = randomBytes(32).toString("base64url");
	try {
		const response = await tenancy.fetch(
			`${tenancy.telegramApiBaseUrl}/bot${botToken}/setWebhook`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					url: `https://auth.${tenant.domain}/telegram/webhook`,
					secret_token: webhookSecret,
					allowed_updates: ["message", "callback_query"],
				}),
				redirect: "error",
				signal: AbortSignal.timeout(10_000),
			},
		);
		const body: unknown = await response.json().catch(() => undefined);
		const ok =
			typeof body === "object" &&
			body !== null &&
			Reflect.get(body, "ok") === true;
		if (!response.ok || !ok) return "telegram-refused";
	} catch {
		return "telegram-refused";
	}
	await tenancy.secrets.put(
		tenant._id,
		"telegram",
		JSON.stringify({ token: botToken, username: botUsername, webhookSecret }),
	);
	return applied(tenancy, tenant, "telegram");
}
