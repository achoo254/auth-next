import type { KoaContextWithOIDC } from "oidc-provider";
import { isStaticClientId } from "../oidc/clients.js";
import { alertBox, pageTitle, submitButton } from "../ui/components.js";
import { html, trustedHtml } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { clientLabel } from "./client-label.js";
import { sendKoaPage } from "./koa-page.js";

/**
 * `features.rpInitiatedLogout.logoutSource`. `form` is oidc-provider's own
 * hidden form (id op.logoutForm, with its xsrf field); the buttons submit
 * it with or without `logout=yes`.
 */
export async function logoutSource(
	ctx: KoaContextWithOIDC,
	form: string,
): Promise<void> {
	const client = ctx.oidc.client;
	const body = html`${pageTitle(
		"Đăng xuất",
		client?.clientName
			? html`${clientLabel(client.clientName, !isStaticClientId(client.clientId))} muốn đăng xuất bạn khỏi tài khoản hoandat.`
			: "Đăng xuất khỏi tài khoản hoandat trên trình duyệt này?",
	)}
${trustedHtml(form)}
<div class="auth-form">
${submitButton("Đăng xuất", { block: true, name: "logout", value: "yes", form: "op.logoutForm", dataId: "logout-confirm" })}
${submitButton("Không, giữ đăng nhập", { block: true, variant: "secondary", form: "op.logoutForm", dataId: "logout-cancel" })}
</div>
<p class="help">Đăng xuất ở đây cũng đăng xuất Localman và Tunelo web trên trình duyệt này.</p>`;
	sendKoaPage(ctx, renderPage({ title: "Đăng xuất", body, host: ctx.host }));
}

/** `features.rpInitiatedLogout.postLogoutSuccessSource`. */
export async function postLogoutSuccessSource(
	ctx: KoaContextWithOIDC,
): Promise<void> {
	const body = html`${pageTitle("Đã đăng xuất")}
${alertBox("success", "Bạn đã đăng xuất khỏi tài khoản hoandat trên trình duyệt này.")}
<p class="auth-foot"><a class="link" href="/account" data-id="logout-signin-again">Đăng nhập lại</a></p>`;
	sendKoaPage(ctx, renderPage({ title: "Đã đăng xuất", body, host: ctx.host }));
}
