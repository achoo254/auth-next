import type { Request, Response } from "express";
import type {
	LoginThrottle,
	ThrottleSubject,
} from "../accounts/login-throttle.js";
import {
	burnPasswordCheck,
	verifySecret,
} from "../accounts/password-hasher.js";
import {
	type AccountDocument,
	normalizeEmail,
} from "../accounts/user-model.js";
import { ipThrottleKey } from "../http/client-ip.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import type { AppServices } from "../services.js";
import { sendPage } from "../ui/send-page.js";
import {
	type Interaction,
	clientIp,
	csrfScope,
	interactionClientId,
} from "./interaction-helpers.js";
import { renderLogin } from "./login-page.js";

export const LOCKED_MESSAGE =
	"Tạm khoá do nhập sai nhiều lần. Thử lại sau 15 phút.";
export const BAD_CREDENTIALS_MESSAGE =
	"Email/username hoặc mật khẩu không đúng.";

export interface LoginExtras {
	readonly error?: string;
	readonly notice?: string;
	readonly identifier?: string;
	readonly status?: number;
}

/** The login page for `interaction`, optionally with an error or notice. */
export async function showLogin(
	services: AppServices,
	req: Request,
	res: Response,
	interaction: Interaction,
	extra: LoginExtras = {},
): Promise<void> {
	const client = await services.provider.Client.find(
		interactionClientId(interaction),
	);
	sendPage(
		res,
		renderLogin({
			host: services.host,
			uid: interaction.uid,
			csrf: services.csrf.token(req, res, csrfScope(interaction.uid)),
			providers: [...services.upstreams.keys()],
			// The account page is the IdP itself, not an app to "continue to".
			clientName:
				client?.clientId === STATIC_CLIENT_IDS.accountPortal
					? undefined
					: client?.clientName,
			forDevice: interaction.deviceCode !== undefined,
			...extra,
		}),
		extra.status,
	);
}

/** Normalised username/email for lookups and lockout keys. */
export function normalizeIdentifier(raw: string): string {
	return normalizeEmail(raw).replace(/^@/, "");
}

/**
 * Whom an attempt counts against: the account itself when it exists (so a
 * username and an email of one account share one budget), otherwise the
 * normalised identifier; plus the client IP (IPv6 by /64). A browser that
 * signed in to the account with its current credentials is counted on its
 * own device budget instead of the account's (unless `deviceExemption` is
 * false, as for Telegram reset requests).
 */
export function throttleSubject(
	services: AppServices,
	req: Request,
	identifier: string,
	account: AccountDocument | undefined,
	options: { readonly deviceExemption?: boolean } = {},
): ThrottleSubject {
	const exempt = options.deviceExemption ?? true;
	return {
		identifier: account?._id ?? identifier,
		ip: ipThrottleKey(clientIp(req)),
		device:
			exempt && account ? services.devices.deviceId(req, account) : undefined,
	};
}

export type PasswordCheck =
	| { readonly ok: true; readonly account: AccountDocument }
	| { readonly ok: false; readonly reason: "locked" | "invalid" };

/**
 * One password attempt against `account` (which may be missing). The
 * attempt is reserved atomically first, so parallel requests get at most
 * the allowed number of verifications; then argon2 runs against the real
 * hash or a dummy one (same cost for a missing account).
 */
export async function checkPassword(
	throttle: LoginThrottle,
	subject: ThrottleSubject,
	account: AccountDocument | undefined,
	password: string,
): Promise<PasswordCheck> {
	const reservation = await throttle.reserve(subject);
	if (!reservation) return { ok: false, reason: "locked" };
	let valid = false;
	if (account?.passwordHash && !account.disabledAt && password) {
		valid = await verifySecret(account.passwordHash, password);
	} else {
		await burnPasswordCheck(password);
	}
	if (!account || !valid) {
		await reservation.fail();
		return { ok: false, reason: "invalid" };
	}
	await reservation.succeed();
	return { ok: true, account };
}
