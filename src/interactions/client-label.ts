import { type SafeHtml, html } from "../ui/html.js";

/** Label of an app registered through DCR: nobody vouched for it. */
export const EXTERNAL_APP_LABEL = "Ứng dụng bên ngoài";

export function externalAppBadge(dataId: string): SafeHtml {
	return html`<span class="badge badge-warning" data-id="${dataId}">${EXTERNAL_APP_LABEL}</span>`;
}

/**
 * The name a DCR client declared for itself, in quotes so it reads as text
 * the app typed in rather than as a name hoandat vouches for.
 */
export function quotedClientName(name: string, dataId?: string): SafeHtml {
	return html`“<b${dataId ? html` data-id="${dataId}"` : ""}>${name}</b>”`;
}

/** How pages name a client: first-party apps plainly, others as external. */
export function clientLabel(name: string, external: boolean): SafeHtml {
	return external
		? html`${quotedClientName(name)} (ứng dụng bên ngoài)`
		: html`<b>${name}</b>`;
}
