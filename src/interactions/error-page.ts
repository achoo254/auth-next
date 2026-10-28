import type { ErrorOut, KoaContextWithOIDC } from "oidc-provider";
import type { MessageKey } from "../i18n/dictionaries.js";
import { pageTitle } from "../ui/components.js";
import { html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { type PageContext, koaPageContext } from "../ui/page-context.js";
import { sendKoaPage } from "./koa-page.js";

/** OAuth error codes the provider renders, and how the page explains them. */
const ERROR_TEXT: ReadonlyMap<string, MessageKey> = new Map([
	["invalid_request", "providerError.invalidRequest"],
	["invalid_client", "providerError.invalidClient"],
	["invalid_redirect_uri", "providerError.invalidRedirectUri"],
	["unauthorized_client", "providerError.unauthorizedClient"],
	["access_denied", "providerError.accessDenied"],
	["invalid_scope", "providerError.invalidScope"],
	["invalid_target", "providerError.invalidTarget"],
	["login_required", "providerError.loginRequired"],
	["server_error", "providerError.serverError"],
]);

export interface ErrorView {
	readonly page: PageContext;
	readonly title?: string;
	/** Already in the page's language. */
	readonly message: string;
	/** Machine-readable code, shown small for support. */
	readonly code?: string;
	readonly backHref?: string;
	readonly backLabel?: string;
}

export function renderErrorPage(view: ErrorView): string {
	const { i18n } = view.page;
	const title = view.title ?? i18n.t("error.title");
	const body = html`${pageTitle(title)}
<div class="alert alert-error" role="alert" data-id="error-message">${view.message}</div>
${view.code ? html`<p class="help">${i18n.rich("error.code", { code: html`<code data-id="error-code">${view.code}</code>` })}</p>` : ""}
<p class="auth-foot"><a class="link" href="${view.backHref ?? "/account"}" data-id="error-back">${view.backLabel ?? i18n.t("common.backToAccount")}</a></p>`;
	return renderPage({ title, body, page: view.page });
}

function field(source: unknown, key: string): unknown {
	return typeof source === "object" && source !== null
		? Reflect.get(source, key)
		: undefined;
}

/** `ui_locales` of the failed request; ctx.oidc is unset before routing. */
function uiLocalesOf(ctx: KoaContextWithOIDC): unknown {
	return field(field(field(ctx, "oidc"), "params"), "ui_locales");
}

/**
 * `renderError` of oidc-provider. The description from the library is in
 * English and may echo request input, so it is shown only as escaped text.
 */
export async function renderProviderError(
	ctx: KoaContextWithOIDC,
	out: ErrorOut,
): Promise<void> {
	const page = koaPageContext(ctx, { uiLocales: uiLocalesOf(ctx) });
	const message = page.i18n.t(
		ERROR_TEXT.get(out.error) ?? "providerError.unknown",
	);
	const code = out.error_description
		? `${out.error}: ${out.error_description}`
		: out.error;
	sendKoaPage(ctx, renderErrorPage({ page, message, code }));
}
