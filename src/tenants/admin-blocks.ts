import { type HtmlValue, type SafeHtml, html } from "../ui/html.js";
import type { TenantDocument } from "./tenant-registry.js";
import { appHostsFor } from "./tenant.js";

/**
 * Small building blocks shared by the cards of /admin: each one gives a
 * recurring piece of the page (a value to paste elsewhere, numbered setup
 * steps, a saved setting that can be replaced, the tenant's issuer URL) one
 * look and one definition.
 */

/** A value the owner pastes into another console: one click selects it. */
export function copyValue(value: string, dataId?: string): SafeHtml {
	return html`<code class="mono copyable admin-copy"${dataId ? html` data-id="${dataId}"` : ""}>${value}</code>`;
}

/** Numbered setup steps, each a sentence that may hold a copyable value. */
export function setupSteps(steps: readonly HtmlValue[]): SafeHtml {
	return html`<ol class="admin-steps">${steps.map((step) => html`<li>${step}</li>`)}</ol>`;
}

/**
 * A setting that is already saved: what is saved stays visible and the
 * form that replaces it folds away, so a configured card stays short.
 */
export function replaceDisclosure(
	summary: string,
	body: HtmlValue,
	dataId: string,
	open = false,
): SafeHtml {
	return html`<details class="admin-replace" data-id="${dataId}"${open ? html` open` : ""}><summary>${summary}</summary>
<div class="admin-replace-body">${body}</div></details>`;
}

/**
 * After a save that failed, the folded forms open again: the alert on top
 * says what went wrong, the form to correct it is already in view.
 */
export function reopenAfterError(view: {
	readonly result?: { readonly tone: "success" | "error" };
}): boolean {
	return view.result?.tone === "error";
}

/** Label and value of something saved ("Client ID  Ov23…"). */
export function savedValue(label: string, value: HtmlValue): SafeHtml {
	return html`<div class="admin-saved"><span class="label">${label}</span><span class="admin-saved-value">${value}</span></div>`;
}

/** Where people of the tenant sign in: `https://auth.<domain>`. */
export function issuerOf(tenant: TenantDocument): string {
	return `https://${appHostsFor(tenant.domain).auth}`;
}
