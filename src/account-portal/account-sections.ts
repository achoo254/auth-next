import type { Translator } from "../i18n/translator.js";
import { actionButton, actionLink } from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { accountCard, emptyState } from "./account-card.js";
import { accountIcon } from "./account-icons.js";
import type { AccountView } from "./account-page.js";
import type { DeviceGrant } from "./grant-directory.js";
import type { OpenSession } from "./session-directory.js";

/** Confirmation page of "Sign out every other session". */
export const REVOKE_OTHER_SESSIONS_PATH = "/account/sessions/revoke-others";

const BROWSERS: readonly [RegExp, string][] = [
	[/Edg\//, "Edge"],
	[/Firefox\//, "Firefox"],
	[/Chrome\//, "Chrome"],
	[/Safari\//, "Safari"],
];
const SYSTEMS: readonly [RegExp, string][] = [
	[/iPhone|iPad/, "iOS"],
	[/Android/, "Android"],
	[/Mac OS X/, "macOS"],
	[/Windows/, "Windows"],
	[/Linux/, "Linux"],
];

/** A short "Chrome on macOS" style label from a User-Agent. */
export function describeUserAgent(
	i18n: Translator,
	userAgent: string | undefined,
): string {
	if (!userAgent) return i18n.t("account.sessions.unknownBrowser");
	const browser =
		BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ??
		i18n.t("account.sessions.browser");
	const system =
		SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1] ??
		i18n.t("account.sessions.unknownSystem");
	return i18n.t("account.sessions.browserOn", { browser, system });
}

function sessionRow(view: AccountView, session: OpenSession): SafeHtml {
	const { i18n } = view.page;
	const current = session.uid === view.currentSessionUid;
	const signedIn = i18n.t("account.sessions.signedInAt", {
		date: i18n.date(session.loginAt),
	});
	return html`<li class="item-row" data-id="session-${session.uid}">
<div><b>${describeUserAgent(i18n, session.userAgent)}</b>${current ? html` <span class="badge badge-primary" data-id="session-current">${i18n.t("account.sessions.thisBrowser")}</span>` : ""}
<p class="help">${signedIn}${session.ip ? html` · IP <code>${session.ip}</code>` : ""}</p></div>
${actionButton(
	`/account/sessions/${session.uid}/revoke`,
	view.csrf,
	current
		? i18n.t("account.sessions.signOutThis")
		: i18n.t("account.sessions.signOut"),
	{ dataId: `session-revoke-${session.uid}` },
)}
</li>`;
}

export function sessionsCard(view: AccountView): SafeHtml {
	const { i18n } = view.page;
	const { sessions } = view;
	return accountCard({
		id: "sessions",
		icon: accountIcon("sessions"),
		title: i18n.t("account.sessions.title"),
		description: i18n.t("account.sessions.description"),
		count: sessions.length,
		body:
			sessions.length === 0
				? emptyState(i18n.t("account.sessions.empty"), "account-sessions-empty")
				: html`<ul class="item-list">${sessions.map((session) => sessionRow(view, session))}</ul>`,
		footer:
			sessions.length >= 2
				? actionLink(
						REVOKE_OTHER_SESSIONS_PATH,
						i18n.t("account.sessions.signOutOthers"),
						{ dataId: "sessions-revoke-others" },
					)
				: undefined,
	});
}

function deviceRow(view: AccountView, device: DeviceGrant): SafeHtml {
	const { i18n } = view.page;
	const dates = i18n.t("account.devices.dates", {
		granted: i18n.date(device.grantedAt),
		expires: i18n.date(device.expiresAt),
	});
	return html`<li class="item-row" data-id="device-${device.grantId}">
<div><b>${device.deviceName ?? i18n.t("device.unknownName")}</b>
<p class="help">${dates}</p></div>
${actionButton(`/account/devices/${device.grantId}/revoke`, view.csrf, i18n.t("account.devices.signOut"), { dataId: `device-revoke-${device.grantId}` })}
</li>`;
}

export function devicesCard(view: AccountView): SafeHtml {
	const { i18n } = view.page;
	const { devices } = view;
	return accountCard({
		id: "devices",
		icon: accountIcon("devices"),
		title: i18n.t("account.devices.title"),
		description: i18n.t("account.devices.description"),
		count: devices.length,
		body:
			devices.length === 0
				? emptyState(
						i18n.rich("account.devices.empty", {
							command: html`<code>tunelo login</code>`,
						}),
						"account-devices-empty",
					)
				: html`<ul class="item-list">${devices.map((device) => deviceRow(view, device))}</ul>`,
	});
}
