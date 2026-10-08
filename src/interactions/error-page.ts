import type { ErrorOut, KoaContextWithOIDC } from "oidc-provider";
import { pageTitle } from "../ui/components.js";
import { html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { sendKoaPage } from "./koa-page.js";

const ERROR_TEXT: Readonly<Record<string, string>> = {
	invalid_request:
		"Yêu cầu đăng nhập không hợp lệ hoặc đã hết hạn. Quay lại ứng dụng và thử lại.",
	invalid_client: "Ứng dụng yêu cầu đăng nhập không hợp lệ.",
	invalid_redirect_uri: "Địa chỉ quay về của ứng dụng không hợp lệ.",
	unauthorized_client: "Ứng dụng không được phép dùng cách đăng nhập này.",
	access_denied: "Yêu cầu đã bị từ chối.",
	invalid_scope: "Ứng dụng xin quyền không được hỗ trợ.",
	invalid_target: "Ứng dụng xin quyền cho một dịch vụ không được phép.",
	login_required: "Bạn cần đăng nhập để tiếp tục.",
	server_error: "Có lỗi phía máy chủ. Thử lại sau ít phút.",
};

export interface ErrorView {
	readonly host: string;
	readonly title?: string;
	readonly message: string;
	/** Machine-readable code, shown small for support. */
	readonly code?: string;
	readonly backHref?: string;
	readonly backLabel?: string;
}

export function renderErrorPage(view: ErrorView): string {
	const body = html`${pageTitle(view.title ?? "Không thể tiếp tục")}
<div class="alert alert-error" role="alert" data-id="error-message">${view.message}</div>
${view.code ? html`<p class="help">Mã lỗi: <code data-id="error-code">${view.code}</code></p>` : ""}
<p class="auth-foot"><a class="link" href="${view.backHref ?? "/account"}" data-id="error-back">${view.backLabel ?? "Về trang tài khoản"}</a></p>`;
	return renderPage({ title: view.title ?? "Lỗi", body, host: view.host });
}

/**
 * `renderError` of oidc-provider. The description from the library is in
 * English and may echo request input, so it is shown only as escaped text.
 */
export async function renderProviderError(
	ctx: KoaContextWithOIDC,
	out: ErrorOut,
): Promise<void> {
	const message =
		ERROR_TEXT[out.error] ?? "Không xử lý được yêu cầu. Thử lại sau ít phút.";
	const code = out.error_description
		? `${out.error}: ${out.error_description}`
		: out.error;
	sendKoaPage(ctx, renderErrorPage({ host: ctx.host, message, code }));
}
