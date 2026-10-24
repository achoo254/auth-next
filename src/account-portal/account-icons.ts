import { type SafeHtml, html } from "../ui/html.js";

/**
 * Line icons of the /account cards, inline SVG drawn in currentColor (the
 * stroke width comes from the --icon-stroke token in app.css).
 */
const SHAPES = {
	profile: html`<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/>`,
	signIn: html`<circle cx="7.5" cy="15.5" r="3.5"/><path d="M10 13l9-9M15.5 7.5l3 3M13 10l2 2"/>`,
	sessions: html`<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>`,
	devices: html`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>`,
	apps: html`<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>`,
	telegram: html`<path d="M21 3L3 10.5l7 2.5 2.5 7L21 3z"/><path d="M10 13l4-4"/>`,
	globe: html`<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>`,
	certificate: html`<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>`,
	delete: html`<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>`,
} as const;

export type AccountIcon = keyof typeof SHAPES;

export function accountIcon(name: AccountIcon): SafeHtml {
	return html`<svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${SHAPES[name]}</svg>`;
}
