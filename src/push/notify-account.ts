import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import type { AccountDocument } from "../accounts/user-model.js";
import { brandOf } from "../i18n/translator.js";
import { ACCOUNT_IOS_CLIENT_ID } from "../oidc/account-ios-client.js";
import { isStaticClientId } from "../oidc/clients.js";
import type { AppServices } from "../services.js";
import { notifyTelegram } from "../telegram/notify.js";
import type { PushSender } from "./apns-client.js";
import { type PushEvent, noticeText, pushPayload } from "./push-payload.js";

type NotifiedAccount = Pick<
	AccountDocument,
	"_id" | "username" | "telegram" | "telegramLocale" | "chatNotices"
>;

export interface NotifyOptions {
	/** The phone that made the change: it does not need telling. */
	readonly exceptGrantId?: string;
	/** Telegram's reclaimed-email notice names the address; push never does. */
	readonly reclaimedEmail?: string;
}

/** The two notices Telegram has always sent, unchanged. */
function telegramNotice(
	services: AppServices,
	account: NotifiedAccount,
	event: PushEvent,
	options: NotifyOptions,
): void {
	if (event.kind === "provider-linked") {
		notifyTelegram(services, account, "bot.notice.providerLinked", {
			username: account.username,
			provider: UPSTREAM_LABELS[event.provider],
		});
	}
	if (event.kind === "email-reclaimed") {
		notifyTelegram(services, account, "bot.notice.emailReclaimed", {
			email: options.reclaimedEmail ?? "",
			username: account.username,
			provider: UPSTREAM_LABELS[event.provider],
		});
	}
}

/** Every notice push sends, also through Chat when the owner turned it on. */
function chatNotice(
	services: AppServices,
	account: NotifiedAccount,
	event: PushEvent,
): void {
	const sender = services.chatNotices;
	const settings = account.chatNotices;
	if (!sender || !settings) return;
	const { title, body } = noticeText(
		event,
		settings.locale,
		brandOf(services.tenant),
	);
	sender.send(account._id, `${title}\n${body}`).catch((error: unknown) => {
		services.logger.warn(
			{ err: error, accountId: account._id, kind: event.kind },
			"Chat notice not sent",
		);
	});
}

/**
 * Sends to every phone of the account whose app grant is still alive.
 * A phone whose grant is gone (revoked, signed out, expired) is forgotten
 * instead, so it never hears about the account again.
 */
async function pushToDevices(
	services: AppServices,
	sender: PushSender,
	accountId: string,
	event: PushEvent,
	exceptGrantId: string | undefined,
): Promise<void> {
	const devices = await services.pushDevices.listFor(accountId, exceptGrantId);
	const brand = brandOf(services.tenant);
	const at = new Date();
	await Promise.all(
		devices.map(async (device) => {
			const grant = await services.provider.Grant.find(device.grantId);
			if (
				!grant ||
				grant.accountId !== accountId ||
				grant.clientId !== ACCOUNT_IOS_CLIENT_ID
			) {
				await services.pushDevices.removeGrants([device.grantId]);
				return;
			}
			const result = await sender.send(
				device,
				pushPayload(event, device.locale, brand, at),
			);
			if (result.status === "unregistered") {
				await services.pushDevices.removeToken(device.token, result.at);
			} else if (result.status === "bad-token") {
				await services.pushDevices.removeToken(device.token);
			}
		}),
	);
}

/**
 * Tells the account owner about a security event: on Telegram as before,
 * through Chat when turned on (ADR 0017), and on the phones running the
 * account app. In the background and best
 * effort: neither ever delays or fails the change itself.
 */
export function notifyAccount(
	services: AppServices,
	account: NotifiedAccount | undefined,
	event: PushEvent,
	options: NotifyOptions = {},
): void {
	if (!account) return;
	telegramNotice(services, account, event, options);
	chatNotice(services, account, event);
	const sender = services.pushSender;
	if (!sender) return;
	pushToDevices(
		services,
		sender,
		account._id,
		event,
		options.exceptGrantId,
	).catch((error: unknown) => {
		services.logger.warn(
			{ err: error, accountId: account._id, kind: event.kind },
			"Push notice not sent",
		);
	});
}

/**
 * The name a notice may show for a client: first-party apps only, since a
 * self-registered (DCR) client chooses its own name.
 */
export async function noticeAppName(
	services: AppServices,
	clientId: string,
): Promise<string | undefined> {
	if (!isStaticClientId(clientId)) return undefined;
	const client = await services.provider.Client.find(clientId);
	return client?.clientName ?? undefined;
}
