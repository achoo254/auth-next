import { type HtmlValue, type SafeHtml, html } from "../ui/html.js";

export interface AccountCardOptions {
	/** Becomes the element id `account-<id>` (Localman links to some). */
	readonly id: string;
	readonly icon: SafeHtml;
	readonly title: string;
	/** One line saying what the card is for. */
	readonly description: string;
	/** How many items the card lists, or its state; omitted for forms. */
	readonly count?: string | number;
	readonly body: HtmlValue;
	/** Actions under the list (e.g. "Sign out every other session"). */
	readonly footer?: HtmlValue;
}

/** One section of /account: icon, title, description, count, content. */
export function accountCard(options: AccountCardOptions): SafeHtml {
	const id = `account-${options.id}`;
	return html`<section class="card account-card" id="${id}" data-id="${id}" aria-labelledby="${id}-title">
<header class="account-card-head">
<span class="account-card-icon">${options.icon}</span>
<div class="account-card-heading"><h3 class="account-card-title" id="${id}-title">${options.title}</h3>
<p class="help">${options.description}</p></div>
${options.count === undefined ? "" : html`<span class="badge badge-neutral account-card-count" data-id="${id}-count">${options.count}</span>`}
</header>
<div class="account-card-body">${options.body}</div>
${options.footer ? html`<div class="account-card-foot">${options.footer}</div>` : ""}
</section>`;
}

/** A headed group of cards ("Security"). */
export function accountGroup(
	id: string,
	title: string,
	cards: readonly SafeHtml[],
): SafeHtml {
	return html`<section class="account-group" aria-labelledby="group-${id}" data-id="group-${id}">
<h2 class="account-group-title" id="group-${id}">${title}</h2>
<div class="account-grid">${cards}</div>
</section>`;
}

/** What a card shows when it has nothing to list. */
export function emptyState(text: HtmlValue, dataId: string): SafeHtml {
	return html`<p class="account-empty" data-id="${dataId}">${text}</p>`;
}
