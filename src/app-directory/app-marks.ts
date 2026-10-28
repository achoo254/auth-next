// The AI-drawn marks of the apps on /apps, and how a page draws one.
import { type SafeHtml, html } from "../ui/html.js";

export type AppIconName =
	| "localman"
	| "mcp"
	| "terminal"
	| "tunnel"
	| "chat"
	| "scribe"
	| "miu"
	| "tieude"
	| "tuvi"
	| "clip"
	| "webnhanh";

/**
 * The AI-drawn app marks (rounded, transparent corners), served from
 * static/img/apps through /assets/img. Tunelo's web app uses the tunnel mark.
 */
const ICON_FILES: Readonly<Record<AppIconName, string>> = {
	localman: "localman-mark-128.webp",
	mcp: "mcp-mark-128.webp",
	terminal: "terminal-mark-128.webp",
	tunnel: "tunelo-mark-128.webp",
	chat: "chat-mark-128.webp",
	scribe: "scribe-mark-128.webp",
	miu: "miu-mark-128.webp",
	tieude: "tieude-mark-128.webp",
	tuvi: "tuvi-mark-128.webp",
	clip: "clip-mark-128.webp",
	webnhanh: "webnhanh-mark-128.webp",
};

/**
 * An app's mark, decorative (the app's name is always beside it). `size`
 * sets the drawn size; inside an SVG pass `x`/`y` to place it (an <image>).
 */
export function appIcon(
	name: AppIconName,
	options: {
		readonly size?: number;
		readonly x?: number;
		readonly y?: number;
	} = {},
): SafeHtml {
	const size = options.size ?? 22;
	const src = `/assets/img/apps/${ICON_FILES[name]}`;
	if (options.x !== undefined) {
		return html`<image href="${src}" x="${options.x}" y="${options.y ?? 0}" width="${size}" height="${size}" aria-hidden="true"/>`;
	}
	return html`<img class="app-mark" src="${src}" width="${size}" height="${size}" alt="">`;
}
