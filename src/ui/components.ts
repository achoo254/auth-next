import { type HtmlValue, type SafeHtml, html } from "./html.js";

export type AlertTone = "error" | "info" | "success" | "warning";

export function alertBox(tone: AlertTone, message: HtmlValue): SafeHtml {
	const role = tone === "error" ? "alert" : "status";
	return html`<div class="alert alert-${tone}" role="${role}" data-id="alert-${tone}">${message}</div>`;
}

/** Optional alert: renders nothing when there is no message. */
export function maybeAlert(
	tone: AlertTone,
	message: string | undefined,
): SafeHtml {
	return message ? alertBox(tone, message) : html``;
}

export function csrfField(token: string): SafeHtml {
	return html`<input type="hidden" name="csrf" value="${token}">`;
}

export interface InputOptions {
	readonly name: string;
	/** Element id; defaults to f-<name>. Needed when a page repeats a name. */
	readonly id?: string;
	readonly label: string;
	readonly type?: "text" | "email" | "password";
	readonly value?: string;
	readonly autocomplete?: string;
	readonly placeholder?: string;
	readonly help?: string;
	readonly required?: boolean;
	readonly minlength?: number;
	readonly maxlength?: number;
	readonly pattern?: string;
	readonly autofocus?: boolean;
}

export function inputField(options: InputOptions): SafeHtml {
	const id = options.id ?? `f-${options.name}`;
	return html`<div class="field">
<label class="label" for="${id}">${options.label}</label>
<input class="input" id="${id}" name="${options.name}" type="${options.type ?? "text"}"${
		options.value !== undefined ? html` value="${options.value}"` : ""
	}${options.autocomplete ? html` autocomplete="${options.autocomplete}"` : ""}${
		options.placeholder ? html` placeholder="${options.placeholder}"` : ""
	}${options.minlength ? html` minlength="${options.minlength}"` : ""}${
		options.maxlength ? html` maxlength="${options.maxlength}"` : ""
	}${options.pattern ? html` pattern="${options.pattern}"` : ""}${
		options.required === false ? "" : html` required`
	}${options.autofocus ? html` autofocus` : ""} data-id="input-${options.name}">
${options.help ? html`<p class="help">${options.help}</p>` : ""}
</div>`;
}

export function submitButton(
	label: string,
	options: {
		readonly variant?: "primary" | "secondary" | "danger" | "minimal";
		readonly name?: string;
		readonly value?: string;
		readonly block?: boolean;
		readonly dataId?: string;
		readonly form?: string;
	} = {},
): SafeHtml {
	const classes = [
		"btn",
		`btn-${options.variant ?? "primary"}`,
		options.block ? "btn-block" : "",
	]
		.filter(Boolean)
		.join(" ");
	return html`<button class="${classes}" type="submit"${
		options.name ? html` name="${options.name}"` : ""
	}${options.value ? html` value="${options.value}"` : ""}${
		options.form ? html` form="${options.form}"` : ""
	}${options.dataId ? html` data-id="${options.dataId}"` : ""}>${label}</button>`;
}

/** A form with a single CSRF-protected POST button (e.g. "Thu hồi"). */
export function actionButton(
	action: string,
	csrf: string,
	label: string,
	options: { readonly variant?: "secondary" | "danger"; dataId?: string } = {},
): SafeHtml {
	return html`<form method="post" action="${action}" class="inline-form">${csrfField(csrf)}${submitButton(
		label,
		{ variant: options.variant ?? "secondary", dataId: options.dataId },
	)}</form>`;
}

export function pageTitle(title: string, subtitle?: HtmlValue): SafeHtml {
	return html`<h1 class="auth-title">${title}</h1>${
		subtitle ? html`<p class="auth-sub">${subtitle}</p>` : ""
	}`;
}

export function linkButton(
	href: string,
	label: string,
	variant: "primary" | "secondary" | "minimal" = "secondary",
	dataId?: string,
): SafeHtml {
	return html`<a class="btn btn-${variant} btn-block" href="${href}"${
		dataId ? html` data-id="${dataId}"` : ""
	}>${label}</a>`;
}
