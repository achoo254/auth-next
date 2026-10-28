/**
 * Auto-escaping HTML templates. Every interpolated value is escaped unless
 * it is already a SafeHtml produced by `html` itself (or `trustedHtml` for
 * markup that oidc-provider generates). Pages never concatenate raw strings.
 */
export class SafeHtml {
	constructor(readonly value: string) {}

	toString(): string {
		return this.value;
	}
}

export type HtmlValue =
	| SafeHtml
	| string
	| number
	| boolean
	| null
	| undefined
	| readonly HtmlValue[];

const ESCAPES: Readonly<Record<string, string>> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
	"`": "&#96;",
};

export function escapeHtml(value: string): string {
	return value.replace(/[&<>"'`]/g, (char) => ESCAPES[char] ?? char);
}

function render(value: HtmlValue): string {
	if (value instanceof SafeHtml) return value.value;
	if (Array.isArray(value)) return value.map(render).join("");
	// false/null/undefined render nothing so conditionals read naturally.
	if (value === null || value === undefined || value === false) return "";
	return escapeHtml(String(value));
}

export function html(
	strings: TemplateStringsArray,
	...values: readonly HtmlValue[]
): SafeHtml {
	let out = strings[0] ?? "";
	values.forEach((value, index) => {
		out += render(value) + (strings[index + 1] ?? "");
	});
	return new SafeHtml(out);
}

/**
 * Marks markup as safe without escaping. Only for HTML that oidc-provider
 * builds itself (its logout form) and the shell markup React renders
 * (ui/layout.ts; React escapes every value), never for user or request data.
 */
export function trustedHtml(markup: string): SafeHtml {
	return new SafeHtml(markup);
}
