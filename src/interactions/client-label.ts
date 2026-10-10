import type { Translator } from "../i18n/translator.js";
import { type SafeHtml, html } from "../ui/html.js";

/** Badge of an app registered through DCR: nobody vouched for it. */
export function externalAppBadge(i18n: Translator, dataId: string): SafeHtml {
	return html`<span class="badge badge-warning" data-id="${dataId}">${i18n.t("client.external")}</span>`;
}

/**
 * The name a DCR client declared for itself, in quotes so it reads as text
 * the app typed in rather than as a name hoandat vouches for.
 */
export function quotedClientName(
	i18n: Translator,
	name: string,
	dataId?: string,
): SafeHtml {
	return i18n.rich("client.quoted", {
		name: html`<b${dataId ? html` data-id="${dataId}"` : ""}>${name}</b>`,
	});
}

/** How pages name a client: first-party apps plainly, others as external. */
export function clientLabel(
	i18n: Translator,
	name: string,
	external: boolean,
): SafeHtml {
	return external
		? i18n.rich("client.externalNamed", {
				name: quotedClientName(i18n, name),
			})
		: html`<b>${name}</b>`;
}
