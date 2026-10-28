import type { KoaContextWithOIDC } from "oidc-provider";
import { isStaticClientId } from "../oidc/clients.js";
import { OIDC_ROUTES } from "../oidc/provider.js";
import { alertBox, pageTitle, submitButton } from "../ui/components.js";
import { html, trustedHtml } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { koaPageContext } from "../ui/page-context.js";
import { clientLabel } from "./client-label.js";
import { sendKoaPage } from "./koa-page.js";

/**
 * `features.rpInitiatedLogout.logoutSource`. `form` is oidc-provider's own
 * hidden form (id op.logoutForm, with its xsrf field); the buttons submit
 * it with or without `logout=yes`. The language switcher returns to the
 * bare logout URL: the request's id_token_hint must not travel further.
 */
export async function logoutSource(
	ctx: KoaContextWithOIDC,
	form: string,
): Promise<void> {
	const page = koaPageContext(ctx, { path: OIDC_ROUTES.end_session });
	const { i18n } = page;
	const client = ctx.oidc.client;
	const title = i18n.t("logout.title");
	const body = html`${pageTitle(
		title,
		client?.clientName
			? i18n.rich("logout.byApp", {
					app: clientLabel(
						i18n,
						client.clientName,
						!isStaticClientId(client.clientId),
					),
				})
			: i18n.t("logout.question"),
	)}
${trustedHtml(form)}
<div class="auth-form">
${submitButton(i18n.t("logout.confirm"), { block: true, name: "logout", value: "yes", form: "op.logoutForm", dataId: "logout-confirm" })}
${submitButton(i18n.t("logout.keep"), { block: true, variant: "secondary", form: "op.logoutForm", dataId: "logout-cancel" })}
</div>
<p class="help">${i18n.t("logout.help")}</p>`;
	sendKoaPage(ctx, renderPage({ title, body, page }));
}

/** `features.rpInitiatedLogout.postLogoutSuccessSource`. */
export async function postLogoutSuccessSource(
	ctx: KoaContextWithOIDC,
): Promise<void> {
	const page = koaPageContext(ctx);
	const { i18n } = page;
	const title = i18n.t("logout.doneTitle");
	const body = html`${pageTitle(title)}
${alertBox("success", i18n.t("logout.done"))}
<p class="auth-foot"><a class="link" href="/account" data-id="logout-signin-again">${i18n.t("logout.signInAgain")}</a></p>`;
	sendKoaPage(ctx, renderPage({ title, body, page }));
}
