import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import {
	type AccountDocument,
	UPSTREAM_PROVIDERS,
	type UpstreamProvider,
	loginMethodCount,
} from "../accounts/user-model.js";
import { providerIdentity } from "../interactions/security-review-page.js";
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

function passwordSection(view: AccountView): SafeHtml {
	const hasPassword = view.account.passwordHash !== undefined;
	return html`<section class="account-section" id="account-password" data-id="account-password">
<h2 class="section-title">${hasPassword ? "Đổi mật khẩu" : "Đặt mật khẩu"}</h2>
<form class="auth-form" method="post" action="/account/password" novalidate>${csrfField(view.csrf)}
${hasPassword ? inputField({ name: "current_password", label: "Mật khẩu hiện tại", type: "password", autocomplete: "current-password", maxlength: 256 }) : ""}
${inputField({ name: "password", label: "Mật khẩu mới", type: "password", autocomplete: "new-password", minlength: 7, maxlength: 256, help: "Ít nhất 7 ký tự." })}
${inputField({ name: "password_confirm", label: "Nhập lại mật khẩu mới", type: "password", autocomplete: "new-password", minlength: 7, maxlength: 256 })}
<label class="check-row"><input type="checkbox" name="logout_everywhere" value="yes" checked data-id="password-logout-everywhere"> Đăng xuất khỏi mọi thiết bị và ứng dụng</label>
<p class="help">Các trình duyệt khác luôn bị đăng xuất. Đổi mật khẩu, mã khôi phục và liên kết đăng nhập cần đăng nhập trong 10 phút gần đây.</p>
${submitButton(hasPassword ? "Đổi mật khẩu" : "Đặt mật khẩu", { variant: "secondary", dataId: "password-save" })}</form>
</section>`;
}

function recoverySection(view: AccountView): SafeHtml {
	return html`<section class="account-section" id="account-recovery" data-id="account-recovery">
<h2 class="section-title">Mã khôi phục</h2>
<p class="help">Còn <b data-id="recovery-remaining">${view.account.recoveryCodeHashes.length}</b> mã chưa dùng. Tạo bộ mới thì bộ cũ hết hiệu lực.</p>
${actionButton("/account/recovery-codes", view.csrf, "Tạo lại 8 mã", { dataId: "recovery-regenerate" })}
</section>`;
}

function providerRow(
	view: AccountView,
	provider: UpstreamProvider,
	lastMethod: boolean,
): SafeHtml {
	const linked = view.account.providers[provider] !== undefined;
	let status = "Chưa liên kết";
	let action = !view.providers.includes(provider)
		? html``
		: actionButton(`/account/link/${provider}`, view.csrf, "Liên kết", {
				dataId: `provider-link-${provider}`,
			});
	const identity = providerIdentity(view.account, provider);
	if (linked && lastMethod) {
		status = `Đã liên kết (${identity}) · đây là cách đăng nhập duy nhất, không huỷ được`;
		action = html``;
	} else if (linked) {
		status = `Đã liên kết (${identity})`;
		action = actionButton(
			`/account/unlink/${provider}`,
			view.csrf,
			"Huỷ liên kết",
			{
				dataId: `provider-unlink-${provider}`,
			},
		);
	}
	return html`<li class="item-row" data-id="provider-${provider}"><div><b>${UPSTREAM_LABELS[provider]}</b>
<p class="help">${status}</p></div>${action}</li>`;
}

function providersSection(view: AccountView): SafeHtml {
	// Configured providers (to link) plus any already linked, even if its
	// sign-in is switched off now: a linked identity is always visible.
	const shown = UPSTREAM_PROVIDERS.filter(
		(provider) =>
			view.providers.includes(provider) ||
			view.account.providers[provider] !== undefined,
	);
	if (shown.length === 0) return html``;
	const lastMethod = loginMethodCount(view.account) <= 1;
	return html`<section class="account-section" data-id="account-providers">
<h2 class="section-title">Đăng nhập bằng Google, GitHub</h2>
<ul class="item-list">${shown.map((provider) => providerRow(view, provider, lastMethod))}</ul>
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
			? html`Đã liên kết với <b>${telegramLabel(linked)}</b> lúc ${formatDate(linked.linkedAt)}. Dùng để nhận thông báo và link đặt lại mật khẩu.`
			: "Liên kết để nhận thông báo và link đặt lại mật khẩu khi quên."
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
			: html`<span data-id="account-email">Chưa có email</span> · đăng nhập bằng username`
	}</p>
${
	account.reclaimedEmail
		? alertBox(
				"warning",
				html`<span data-id="account-email-reclaimed">Email <b>${account.reclaimedEmail.email}</b> đã được gỡ khỏi tài khoản này lúc ${formatDate(account.reclaimedEmail.at)}, vì người sở hữu email đã xác minh nó qua Google/GitHub. Bạn vẫn đăng nhập bằng username @${account.username}.</span>`,
			)
		: ""
}
${notice ? alertBox(notice.tone, notice.text) : ""}
${profileSection(view)}
${passwordSection(view)}
${recoverySection(view)}
${providersSection(view)}
${telegramSection(view)}
${sessionsSection(view.sessions, view.currentSessionUid, view.csrf)}
${devicesSection(view.devices, view.csrf)}
${appsSection(view.apps, view.csrf)}
<p class="auth-foot"><a class="link" href="/session/end" data-id="account-logout">Đăng xuất</a></p>`;
	return renderPage({ title: "Tài khoản", body, host: view.host, wide: true });
}
