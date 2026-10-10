import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import {
	type AccountDocument,
	UPSTREAM_PROVIDERS,
	type UpstreamProvider,
	usableSignInProviders,
} from "../accounts/user-model.js";
import {
	actionButton,
	alertBox,
	csrfField,
	inputField,
	pageTitle,
	submitButton,
} from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import {
	appsSection,
	devicesSection,
	formatDate,
	sessionsSection,
} from "./account-sections.js";
import type { AuthorizedApp, DeviceGrant } from "./grant-directory.js";
import { ACCOUNT_NOTICES } from "./notices.js";
import type { OpenSession } from "./session-directory.js";

export interface AccountView {
	readonly host: string;
	readonly csrf: string;
	readonly account: AccountDocument;
	readonly currentSessionUid: string;
	readonly providers: readonly UpstreamProvider[];
	readonly telegramEnabled: boolean;
	readonly sessions: readonly OpenSession[];
	readonly devices: readonly DeviceGrant[];
	readonly apps: readonly AuthorizedApp[];
	readonly notice?: string;
}

function emailBadge(account: AccountDocument): SafeHtml {
	return account.emailVerifiedBy
		? html`<span class="badge badge-success" data-id="account-email-verified">đã xác minh qua ${UPSTREAM_LABELS[account.emailVerifiedBy]}</span>`
		: html`<span class="badge badge-warning" data-id="account-email-unverified">email chưa xác minh</span>`;
}

function profileSection(view: AccountView): SafeHtml {
	return html`<section class="account-section" data-id="account-profile">
<h2 class="section-title">Hồ sơ</h2>
<form class="auth-form" method="post" action="/account/profile">${csrfField(view.csrf)}
${inputField({ name: "name", label: "Tên hiển thị", value: view.account.name ?? "", maxlength: 100, required: false })}
${submitButton("Lưu", { variant: "secondary", dataId: "profile-save" })}</form>
</section>`;
}

/** "email · @login" a provider vouched for, or "không rõ" for older links. */
function providerIdentity(
	account: AccountDocument,
	provider: UpstreamProvider,
): string {
	const detail = account.providerDetails?.[provider];
	const parts = [
		detail?.email,
		detail?.login ? `@${detail.login}` : undefined,
	].filter((part): part is string => Boolean(part));
	return parts.length > 0 ? parts.join(" · ") : "không rõ";
}

function providerRow(view: AccountView, provider: UpstreamProvider): SafeHtml {
	const label = html`<b>${UPSTREAM_LABELS[provider]}</b>`;
	const enabled = view.providers.includes(provider);
	if (view.account.providers[provider] === undefined) {
		const link = enabled
			? actionButton(`/account/link/${provider}`, view.csrf, "Liên kết", {
					dataId: `provider-link-${provider}`,
				})
			: html``;
		return html`<li class="item-row" data-id="provider-${provider}"><div>${label}
<p class="help">Chưa liên kết</p></div>${link}</li>`;
	}
	// Unlinking needs another linked provider that can sign in here.
	const last =
		usableSignInProviders(view.account, view.providers).filter(
			(other) => other !== provider,
		).length === 0;
	const identity = providerIdentity(view.account, provider);
	const status = last
		? `Đã liên kết (${identity}) · đây là cách đăng nhập duy nhất, không huỷ được`
		: `Đã liên kết (${identity})${enabled ? "" : " · đăng nhập bằng cách này đang tạm tắt"}`;
	const unlink = last
		? html``
		: actionButton(`/account/unlink/${provider}`, view.csrf, "Huỷ liên kết", {
				dataId: `provider-unlink-${provider}`,
			});
	return html`<li class="item-row" data-id="provider-${provider}"><div>${label}
<p class="help">${status}</p></div>${unlink}</li>`;
}

/**
 * How this account signs in: Google and GitHub, the only ways in. Shown are
 * the configured providers (to link) plus any already linked, even if its
 * sign-in is switched off now: a linked identity is always visible.
 */
function signInSection(view: AccountView): SafeHtml {
	const shown = UPSTREAM_PROVIDERS.filter(
		(provider) =>
			view.providers.includes(provider) ||
			view.account.providers[provider] !== undefined,
	);
	return html`<section class="account-section" id="account-sign-in" data-id="account-sign-in">
<h2 class="section-title">Cách đăng nhập</h2>
<p class="help">hoandat không dùng mật khẩu: bạn đăng nhập bằng Google hoặc GitHub. Liên kết cả hai để vẫn vào được tài khoản khi mất một cách.</p>
${shown.length === 0 ? html`<p class="help">Đăng nhập bằng Google và GitHub đang tạm tắt.</p>` : ""}
<ul class="item-list">${shown.map((provider) => providerRow(view, provider))}</ul>
</section>`;
}

/** "@handle (Name)", whatever Telegram told us about the linked chat. */
function telegramLabel(
	telegram: NonNullable<AccountDocument["telegram"]>,
): string {
	const parts = [
		telegram.username ? `@${telegram.username}` : undefined,
		telegram.name,
	].filter((part): part is string => part !== undefined && part !== "");
	return parts.length > 0 ? parts.join(" · ") : `chat ${telegram.chatId}`;
}

function telegramSection(view: AccountView): SafeHtml {
	if (!view.telegramEnabled) return html``;
	const linked = view.account.telegram;
	return html`<section class="account-section" data-id="account-telegram">
<h2 class="section-title">Telegram</h2>
<p class="help" data-id="telegram-status">${
		linked
			? html`Đã liên kết với <b>${telegramLabel(linked)}</b> lúc ${formatDate(linked.linkedAt)}. Dùng để nhận thông báo bảo mật của tài khoản.`
			: "Liên kết để nhận thông báo bảo mật của tài khoản. Telegram không dùng để đăng nhập."
	}</p>
${linked ? actionButton("/account/telegram/unlink", view.csrf, "Huỷ liên kết Telegram", { dataId: "telegram-unlink" }) : actionButton("/account/telegram/link", view.csrf, "Liên kết Telegram", { dataId: "telegram-link" })}
</section>`;
}

/** /account: everything a user can manage about their hoandat account. */
export function renderAccountPage(view: AccountView): string {
	const notice = view.notice ? ACCOUNT_NOTICES.get(view.notice) : undefined;
	const { account } = view;
	const body = html`${pageTitle("Tài khoản hoandat", html`${account.name ? html`${account.name} · ` : ""}<b data-id="account-username">@${account.username}</b>`)}
<p class="help account-anchor" id="account-email">${
		account.email
			? html`<span data-id="account-email">${account.email}</span> ${emailBadge(account)}`
			: html`<span data-id="account-email">Chưa có email</span>`
	}</p>
${
	account.reclaimedEmail
		? alertBox(
				"warning",
				html`<span data-id="account-email-reclaimed">Email <b>${account.reclaimedEmail.email}</b> đã được gỡ khỏi tài khoản này lúc ${formatDate(account.reclaimedEmail.at)}, vì người sở hữu email đã xác minh nó qua Google/GitHub.</span>`,
			)
		: ""
}
${notice ? alertBox(notice.tone, notice.text) : ""}
${profileSection(view)}
${signInSection(view)}
${telegramSection(view)}
${sessionsSection(view.sessions, view.currentSessionUid, view.csrf)}
${devicesSection(view.devices, view.csrf)}
${appsSection(view.apps, view.csrf)}
<p class="auth-foot"><a class="link" href="/session/end" data-id="account-logout">Đăng xuất</a></p>`;
	return renderPage({ title: "Tài khoản", body, host: view.host, wide: true });
}
