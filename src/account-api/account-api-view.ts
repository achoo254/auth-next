import { userAgentParts } from "../account-portal/account-sections.js";
import type { DeviceGrant } from "../account-portal/device-grants.js";
import type { AuthorizedApp } from "../account-portal/grant-directory.js";
import type { OpenSession } from "../account-portal/session-directory.js";
import {
	type AccountDocument,
	UPSTREAM_PROVIDERS,
	type UpstreamProvider,
	usableSignInProviders,
} from "../accounts/user-model.js";

/**
 * JSON of GET /api/account. Every field is copied one by one, so nothing
 * of a stored document leaks by accident: no `securityVersion`, raw
 * `providerDetails` (Apple's `revocationToken`), provider account ids,
 * Telegram chat id, grant ids of apps or session User-Agents. Dates are
 * ISO 8601 strings, absent values `null`. Shared contract with the app:
 * ios/contract/account.json (account-api-contract.test.ts).
 */
export interface AccountView {
	readonly account: {
		readonly id: string;
		readonly username: string;
		readonly name: string | null;
		readonly email: string | null;
		readonly emailVerifiedBy: UpstreamProvider | null;
		readonly picture: string | null;
		readonly createdAt: string;
		readonly reclaimedEmail: {
			readonly email: string;
			readonly at: string;
		} | null;
	};
	readonly providers: readonly {
		readonly provider: UpstreamProvider;
		readonly enabled: boolean;
		readonly linked: boolean;
		readonly email: string | null;
		readonly login: string | null;
		readonly linkedAt: string | null;
		readonly canUnlink: boolean;
	}[];
	readonly telegram: {
		readonly available: boolean;
		readonly linked: boolean;
		readonly username: string | null;
		readonly name: string | null;
		readonly linkedAt: string | null;
	};
	readonly sessions: readonly {
		readonly uid: string;
		readonly loginAt: string | null;
		readonly lastSeenAt: string | null;
		readonly browser: string | null;
		readonly os: string | null;
		readonly ip: string | null;
	}[];
	readonly devices: readonly {
		readonly grantId: string;
		readonly clientId: string;
		readonly appName: string;
		readonly deviceName: string | null;
		readonly grantedAt: string | null;
		readonly expiresAt: string | null;
		readonly current: boolean;
	}[];
	readonly apps: readonly {
		readonly clientId: string;
		readonly name: string;
		readonly firstParty: boolean;
		readonly redirectHosts: readonly string[];
		readonly scopes: readonly string[];
	}[];
	/** Always true: everyone deletes their own account (ADR 0009). Kept for the app. */
	readonly canDelete: boolean;
}

function iso(date: Date | undefined): string | null {
	return date ? date.toISOString() : null;
}

export interface AccountViewInput {
	readonly account: AccountDocument;
	/** Providers this IdP offers now. */
	readonly enabledProviders: readonly UpstreamProvider[];
	readonly telegramAvailable: boolean;
	readonly sessions: readonly OpenSession[];
	readonly devices: readonly DeviceGrant[];
	readonly apps: readonly AuthorizedApp[];
	/** The grant of the calling app: its row is `current`. */
	readonly currentGrantId: string;
}

function providerRows(
	account: AccountDocument,
	enabled: readonly UpstreamProvider[],
): AccountView["providers"] {
	const usable = usableSignInProviders(account, enabled);
	return UPSTREAM_PROVIDERS.map((provider) => {
		const detail = account.providerDetails?.[provider];
		const linked = account.providers[provider] !== undefined;
		return {
			provider,
			enabled: enabled.includes(provider),
			linked,
			email: (linked && detail?.email) || null,
			login: (linked && detail?.login) || null,
			linkedAt: linked ? iso(detail?.linkedAt) : null,
			// The rule of the unlink action: another usable provider remains.
			canUnlink: linked && usable.some((other) => other !== provider),
		};
	});
}

export function accountView(input: AccountViewInput): AccountView {
	const { account } = input;
	const telegram = account.telegram;
	return {
		account: {
			id: account._id,
			username: account.username,
			name: account.name ?? null,
			email: account.email ?? null,
			emailVerifiedBy: account.emailVerifiedBy,
			picture: account.picture ?? null,
			createdAt: account.createdAt.toISOString(),
			reclaimedEmail: account.reclaimedEmail
				? {
						email: account.reclaimedEmail.email,
						at: account.reclaimedEmail.at.toISOString(),
					}
				: null,
		},
		providers: providerRows(account, input.enabledProviders),
		telegram: {
			available: input.telegramAvailable,
			linked: telegram !== undefined,
			username: telegram?.username ?? null,
			name: telegram?.name ?? null,
			linkedAt: iso(telegram?.linkedAt),
		},
		sessions: input.sessions.map((session) => {
			const parts = userAgentParts(session.userAgent);
			return {
				uid: session.uid,
				loginAt: iso(session.loginAt),
				lastSeenAt: iso(session.lastSeenAt),
				browser: parts.browser ?? null,
				os: parts.system ?? null,
				ip: session.ip ?? null,
			};
		}),
		devices: input.devices.map((device) => ({
			grantId: device.grantId,
			clientId: device.clientId,
			appName: device.appName,
			deviceName: device.deviceName ?? null,
			grantedAt: iso(device.grantedAt),
			expiresAt: iso(device.expiresAt),
			current: device.grantId === input.currentGrantId,
		})),
		apps: input.apps.map((app) => ({
			clientId: app.clientId,
			name: app.name,
			firstParty: app.firstParty,
			redirectHosts: [...app.redirectHosts],
			scopes: [...app.scopes],
		})),
		canDelete: true,
	};
}
