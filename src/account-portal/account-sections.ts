import type { Translator } from "../i18n/translator.js";
import { actionButton, actionLink } from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { accountCard, emptyState } from "./account-card.js";
import { accountIcon } from "./account-icons.js";
import type { AccountView } from "./account-page.js";
import type { DeviceGrant } from "./device-grants.js";
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

/** The browser and system a User-Agent names, when recognised. */
export function userAgentParts(userAgent: string | undefined): {
	readonly browser?: string;
	readonly system?: string;
} {
	if (!userAgent) return {};
	return {
		browser: BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1],
		system: SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1],
	};
}

/** A short "Chrome on macOS" style label from a User-Agent. */
export function describeUserAgent(
	i18n: Translator,
	userAgent: string | undefined,
): string {
	if (!userAgent) return i18n.t("account.sessions.unknownBrowser");
	const parts = userAgentParts(userAgent);
	return i18n.t("account.sessions.browserOn", {
		browser: parts.browser ?? i18n.t("account.sessions.browser"),
		system: parts.system ?? i18n.t("account.sessions.unknownSystem"),
	});
}

/** How many places show before the rest fold under "Show N more". */
const VISIBLE_PLACES = 5;

/** Native apps without a machine name sent their User-Agent instead. */
function deviceLabel(view: AccountView, device: DeviceGrant): string {
	const { i18n } = view.page;
	const name = device.deviceName?.startsWith("Mozilla/")
		? describeUserAgent(i18n, device.deviceName)
		: device.deviceName;
	return `${device.appName} · ${name ?? i18n.t("device.unknownName")}`;
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
	{ variant: "minimal", dataId: `session-revoke-${session.uid}` },
)}
</li>`;
}

function deviceRow(view: AccountView, device: DeviceGrant): SafeHtml {
	const { i18n } = view.page;
	const signedIn = i18n.t("account.sessions.signedInAt", {
		date: i18n.date(device.grantedAt),
	});
	return html`<li class="item-row" data-id="device-${device.grantId}">
<div><b>${deviceLabel(view, device)}</b>
<p class="help">${signedIn}</p></div>
${actionButton(`/account/devices/${device.grantId}/revoke`, view.csrf, i18n.t("account.sessions.signOut"), { variant: "minimal", dataId: `device-revoke-${device.grantId}` })}
</li>`;
}

interface Place {
	readonly row: SafeHtml;
	/** Sorts this browser first, then the most recent sign-in. */
	readonly rank: number;
}

/** Every browser session and signed-in machine, this browser first. */
function places(view: AccountView): Place[] {
	const sessions = view.sessions.map((session) => ({
		row: sessionRow(view, session),
		rank:
			session.uid === view.currentSessionUid
				? Number.POSITIVE_INFINITY
				: ((session.lastSeenAt ?? session.loginAt)?.getTime() ?? 0),
	}));
	const devices = view.devices.map((device) => ({
		row: deviceRow(view, device),
		rank: device.grantedAt?.getTime() ?? 0,
	}));
	return [...sessions, ...devices].sort((a, b) => b.rank - a.rank);
}

/** The first rows, then the rest folded in a plain <details> (no script). */
function foldedList(view: AccountView, rows: readonly SafeHtml[]): SafeHtml {
	const { i18n } = view.page;
	const shown = html`<ul class="item-list">${rows.slice(0, VISIBLE_PLACES)}</ul>`;
	const rest = rows.slice(VISIBLE_PLACES);
	if (rest.length === 0) return shown;
	return html`${shown}
<details class="account-more" data-id="account-places-more"><summary>${i18n.t("account.places.more", { count: rest.length })}</summary>
<ul class="item-list">${rest}</ul></details>`;
}

/**
 * "Where you are signed in": browsers and machines (Tunelo, native apps)
 * in one list, since to the owner both are places their account is open.
 */
export function placesCard(view: AccountView): SafeHtml {
	const { i18n } = view.page;
	const rows = places(view).map((place) => place.row);
	return accountCard({
		id: "sessions",
		icon: accountIcon("sessions"),
		title: i18n.t("account.places.title"),
		description: i18n.t("account.places.description"),
		count: rows.length,
		body:
			rows.length === 0
				? emptyState(i18n.t("account.sessions.empty"), "account-sessions-empty")
				: foldedList(view, rows),
		footer:
			view.sessions.length >= 2
				? actionLink(
						REVOKE_OTHER_SESSIONS_PATH,
						i18n.t("account.sessions.signOutOthers"),
						{ dataId: "sessions-revoke-others" },
					)
				: undefined,
	});
}
