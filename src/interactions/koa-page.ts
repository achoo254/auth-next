import type { KoaContextWithOIDC } from "oidc-provider";

/** Writes a rendered page from inside an oidc-provider hook. */
export function sendKoaPage(
	ctx: KoaContextWithOIDC,
	page: string,
	status?: number,
): void {
	if (status) ctx.status = status;
	ctx.type = "html";
	ctx.set("cache-control", "no-store");
	ctx.body = page;
}

/** The anti-CSRF value inside a form oidc-provider generated for us. */
export function xsrfFromProviderForm(form: string): string {
	return /name="xsrf" value="([^"]+)"/.exec(form)?.[1] ?? "";
}
