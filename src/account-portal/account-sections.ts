import { describeScopes } from "../interactions/consent-page.js";
import { actionButton } from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import type { AuthorizedApp, DeviceGrant } from "./grant-directory.js";
import type { OpenSession } from "./session-directory.js";

const DATE_FORMAT = new Intl.DateTimeFormat("vi-VN", {
	timeZone: "Asia/Ho_Chi_Minh",
	dateStyle: "short",
	timeStyle: "short",
});

export function formatDate(date: Date | undefined): string {
	return date ? DATE_FORMAT.format(date) : "không rõ";
}

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

/** A short "Chrome trên macOS" style label from a User-Agent. */
export function describeUserAgent(userAgent: string | undefined): string {
	if (!userAgent) return "Trình duyệt không rõ";
	const browser =
		BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? "Trình duyệt";
	const system =
		SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1] ??
		"hệ điều hành không rõ";
	return `${browser} trên ${system}`;
}

function emptyRow(text: string): SafeHtml {
	return html`<p class="help">${text}</p>`;
}

export function sessionsSection(
	sessions: readonly OpenSession[],
	currentUid: string,
	csrf: string,
): SafeHtml {
	return html`<section class="account-section" data-id="account-sessions">
<h2 class="section-title">Phiên đang mở</h2>
${sessions.length === 0 ? emptyRow("Không có phiên nào.") : ""}
<ul class="item-list">${sessions.map(
		(session) => html`<li class="item-row" data-id="session-${session.uid}">
<div><b>${describeUserAgent(session.userAgent)}</b>${session.uid === currentUid ? html` <span class="badge badge-primary">Phiên này</span>` : ""}
<p class="help">Đăng nhập ${formatDate(session.loginAt)}${session.ip ? html` · IP <code>${session.ip}</code>` : ""}</p></div>
${actionButton(`/account/sessions/${session.uid}/revoke`, csrf, session.uid === currentUid ? "Đăng xuất" : "Thu hồi", { dataId: `session-revoke-${session.uid}` })}
</li>`,
	)}</ul>
</section>`;
}

export function devicesSection(
	devices: readonly DeviceGrant[],
	csrf: string,
): SafeHtml {
	return html`<section class="account-section" data-id="account-devices">
<h2 class="section-title">Thiết bị Tunelo</h2>
${devices.length === 0 ? emptyRow("Chưa có máy nào đăng nhập bằng tunelo login.") : ""}
<ul class="item-list">${devices.map(
		(device) => html`<li class="item-row" data-id="device-${device.grantId}">
<div><b>${device.deviceName}</b>
<p class="help">Cho phép lúc ${formatDate(device.grantedAt)} · hết hạn ${formatDate(device.expiresAt)}</p></div>
${actionButton(`/account/devices/${device.grantId}/revoke`, csrf, "Thu hồi", { dataId: `device-revoke-${device.grantId}` })}
</li>`,
	)}</ul>
</section>`;
}

export function appsSection(
	apps: readonly AuthorizedApp[],
	csrf: string,
): SafeHtml {
	return html`<section class="account-section" data-id="account-apps">
<h2 class="section-title">Ứng dụng đã cấp quyền</h2>
${apps.length === 0 ? emptyRow("Chưa cấp quyền cho ứng dụng nào.") : ""}
<ul class="item-list">${apps.map(
		(app) => html`<li class="item-row" data-id="app-${app.clientId}">
<div><b>${app.name}</b> ${
			app.firstParty
				? html`<span class="badge badge-neutral">hoandat</span>`
				: html`<span class="badge badge-warning">Ứng dụng bên thứ ba chưa xác minh</span>`
		}
${app.redirectHosts.length > 0 ? html`<p class="help">Chuyển về: ${app.redirectHosts.join(", ")}</p>` : ""}
<p class="help">${describeScopes(app.scopes).join(" · ")}</p></div>
${actionButton(`/account/apps/${encodeURIComponent(app.clientId)}/revoke`, csrf, "Thu hồi", { variant: "danger", dataId: `app-revoke-${app.clientId}` })}
</li>`,
	)}</ul>
</section>`;
}
