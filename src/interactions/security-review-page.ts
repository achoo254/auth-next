import { formatDate } from "../account-portal/account-sections.js";
import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import {
	type AccountDocument,
	UPSTREAM_PROVIDERS,
	type UpstreamProvider,
} from "../accounts/user-model.js";
import {
	actionButton,
	alertBox,
	csrfField,
	pageTitle,
	submitButton,
} from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";

/** "email · @login" a provider vouched for, or "không rõ" for older links. */
export function providerIdentity(
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

export interface ReviewView {
	readonly host: string;
	readonly csrf: string;
	/** Form targets live under this path (e.g. /interaction/<uid>/review). */
	readonly base: string;
	readonly account: AccountDocument;
}

function row(
	dataId: string,
	title: SafeHtml,
	detail: SafeHtml,
	action: SafeHtml,
): SafeHtml {
	return html`<li class="item-row" data-id="${dataId}"><div><b>${title}</b><p class="help">${detail}</p></div>${action}</li>`;
}

/**
 * The mandatory "Rà soát bảo mật" page after a password reset: every way
 * back into the account that someone else could have added, each with a
 * remove button. Removing the last sign-in method is fine here: a new
 * password was just set.
 */
export function renderSecurityReview(view: ReviewView): string {
	const { account, base, csrf } = view;
	const linked = UPSTREAM_PROVIDERS.filter(
		(provider) => account.providers[provider],
	);
	const telegram = account.telegram;
	const telegramName = [
		telegram?.username ? `@${telegram.username}` : undefined,
		telegram?.name,
	]
		.filter((part): part is string => Boolean(part))
		.join(" · ");
	const body = html`${pageTitle("Rà soát bảo mật", html`Mật khẩu của <b>@${account.username}</b> vừa được đặt lại.`)}
${alertBox("warning", "Nếu ai đó đã vào được tài khoản, họ có thể đã thêm cách đăng nhập hoặc nhận link khôi phục. Gỡ mọi thứ bạn không nhận ra rồi mới tiếp tục.")}
<section class="account-section" data-id="review-providers">
<h2 class="section-title">Đăng nhập bằng Google, GitHub</h2>
${linked.length === 0 ? html`<p class="help">Không có liên kết nào.</p>` : ""}
<ul class="item-list">${linked.map((provider) =>
		row(
			`review-provider-${provider}`,
			html`${UPSTREAM_LABELS[provider]}`,
			html`${providerIdentity(account, provider)} · liên kết lúc ${formatDate(account.providerDetails?.[provider]?.linkedAt)}`,
			actionButton(`${base}/unlink/${provider}`, csrf, "Gỡ", {
				variant: "danger",
				dataId: `review-unlink-${provider}`,
			}),
		),
	)}</ul>
</section>
<section class="account-section" data-id="review-telegram">
<h2 class="section-title">Telegram</h2>
${
	telegram
		? html`<ul class="item-list">${row(
				"review-telegram-chat",
				html`${telegramName || `chat ${telegram.chatId}`}`,
				html`Liên kết lúc ${formatDate(telegram.linkedAt)}; nhận link đặt lại mật khẩu.`,
				actionButton(`${base}/telegram/unlink`, csrf, "Gỡ", {
					variant: "danger",
					dataId: "review-unlink-telegram",
				}),
			)}</ul>`
		: html`<p class="help">Chưa liên kết.</p>`
}
</section>
<section class="account-section" data-id="review-recovery">
<h2 class="section-title">Mã khôi phục</h2>
<p class="help">Còn <b>${account.recoveryCodeHashes.length}</b> mã; bộ hiện tại tạo lúc ${formatDate(account.recoveryCodesCreatedAt)}. Nếu có thể ai đó đã thấy chúng, hãy tạo bộ mới.</p>
${actionButton(`${base}/recovery-codes`, csrf, "Tạo lại 8 mã", { dataId: "review-regenerate-codes" })}
</section>
<form class="auth-form" method="post" action="${base}/done">${csrfField(csrf)}${submitButton("Tôi đã rà soát", { block: true, dataId: "review-done" })}</form>`;
	return renderPage({
		title: "Rà soát bảo mật",
		body,
		host: view.host,
		wide: true,
	});
}
