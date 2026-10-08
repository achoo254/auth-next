import { z } from "zod";

/**
 * Optional third-party integrations. Each group is all-or-nothing: a
 * partially configured provider is a deployment mistake, not "disabled".
 * When a group is unset its buttons are hidden and its routes answer 404.
 */
export const integrationEnvShape = {
	GOOGLE_CLIENT_ID: z.string().min(1).optional(),
	GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
	GITHUB_CLIENT_ID: z.string().min(1).optional(),
	GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
	TELEGRAM_BOT_TOKEN: z
		.string()
		.regex(/^\d+:[\w-]{20,}$/, "must look like <bot id>:<secret>")
		.optional(),
	/** Bot username without the leading @, used for t.me deep links. */
	TELEGRAM_BOT_USERNAME: z
		.string()
		.regex(/^[A-Za-z][A-Za-z0-9_]{3,31}$/, "must be a Telegram bot username")
		.optional(),
	/** Sent by Telegram in X-Telegram-Bot-Api-Secret-Token on every webhook call. */
	TELEGRAM_WEBHOOK_SECRET: z
		.string()
		.regex(/^[A-Za-z0-9_-]{32,256}$/, "must be 32-256 chars of A-Z a-z 0-9 _ -")
		.optional(),
	TELEGRAM_API_BASE_URL: z
		.url({ protocol: /^https?$/, error: "must be an http(s) URL" })
		.default("https://api.telegram.org"),
	/** Localman's audit intake, e.g. https://localman.hoandat.com/internal/audit-events. */
	AUDIT_EVENTS_URL: z
		.url({ protocol: /^https?$/, error: "must be an http(s) URL" })
		.refine((value) => {
			const url = URL.parse(value);
			return url !== null && !url.username && !url.password;
		}, "must not contain credentials; use AUDIT_CLIENT_ID/SECRET")
		.optional(),
	/** HTTP Basic credentials the IdP presents to the audit intake. */
	AUDIT_CLIENT_ID: z
		.string()
		.regex(/^[^:\s]+$/, "must not contain ':' or whitespace")
		.optional(),
	AUDIT_CLIENT_SECRET: z
		.string()
		.min(32, "must be at least 32 characters")
		.optional(),
};

const GROUPS = [
	["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
	["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
	["TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME", "TELEGRAM_WEBHOOK_SECRET"],
	["AUDIT_EVENTS_URL", "AUDIT_CLIENT_ID", "AUDIT_CLIENT_SECRET"],
] as const;

type GroupKey = (typeof GROUPS)[number][number];

/** Reports every group that is only partly configured. */
export function checkIntegrationGroups(
	env: Readonly<Partial<Record<GroupKey, string>>>,
	ctx: z.RefinementCtx,
): void {
	for (const group of GROUPS) {
		const set = group.filter((key) => env[key] !== undefined);
		if (set.length === 0 || set.length === group.length) continue;
		for (const key of group.filter((name) => env[name] === undefined)) {
			ctx.addIssue({
				code: "custom",
				path: [key],
				message: `must be set together with ${set.join(", ")}`,
			});
		}
	}
}

export interface OAuthAppCredentials {
	readonly clientId: string;
	readonly clientSecret: string;
}

export interface TelegramBotConfig {
	readonly token: string;
	readonly username: string;
	readonly webhookSecret: string;
	readonly apiBaseUrl: string;
}

type IntegrationEnv = {
	readonly [K in GroupKey]?: string | undefined;
} & { readonly TELEGRAM_API_BASE_URL: string };

export function googleCredentials(
	env: IntegrationEnv,
): OAuthAppCredentials | undefined {
	const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } =
		env;
	return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

export function githubCredentials(
	env: IntegrationEnv,
): OAuthAppCredentials | undefined {
	const { GITHUB_CLIENT_ID: clientId, GITHUB_CLIENT_SECRET: clientSecret } =
		env;
	return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

export function telegramBotConfig(
	env: IntegrationEnv,
): TelegramBotConfig | undefined {
	const token = env.TELEGRAM_BOT_TOKEN;
	const username = env.TELEGRAM_BOT_USERNAME;
	const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET;
	if (!token || !username || !webhookSecret) return undefined;
	return {
		token,
		username,
		webhookSecret,
		apiBaseUrl: env.TELEGRAM_API_BASE_URL.replace(/\/+$/, ""),
	};
}

export interface AuditDeliveryConfig {
	readonly url: string;
	readonly clientId: string;
	readonly clientSecret: string;
}

/** Undefined when unset: events then stay in the outbox until configured. */
export function auditDeliveryConfig(
	env: IntegrationEnv,
): AuditDeliveryConfig | undefined {
	const {
		AUDIT_EVENTS_URL: url,
		AUDIT_CLIENT_ID: clientId,
		AUDIT_CLIENT_SECRET: clientSecret,
	} = env;
	return url && clientId && clientSecret
		? { url, clientId, clientSecret }
		: undefined;
}
