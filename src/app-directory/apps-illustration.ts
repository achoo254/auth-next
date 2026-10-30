import type { UpstreamProvider } from "../accounts/user-model.js";
import type { Translator } from "../i18n/translator.js";
import { type SafeHtml, html } from "../ui/html.js";
import { providerPath } from "../ui/provider-logos.js";
import { appIcon } from "./app-marks.js";
import type { ListedApp } from "./apps-catalog.js";

/*
 * The hero diagram: Google, GitHub and Apple lead into one account of the
 * tenant, which fans out to every app. SVG in currentColor and token classes (apps.css),
 * with each app's mark as an <image>; the moving dashes are CSS and stop
 * under reduced motion.
 */

const VIEW = { width: 544, height: 300 } as const;
/** Height given to each app node; the view grows when the apps need more. */
const APP_SLOT = 50;
const KEY = { x: 8, width: 124, height: 40 } as const;
const HUB = {
	cx: 260,
	y: 110,
	minWidth: 128,
	maxWidth: 200,
	height: 80,
} as const;
/** Padding inside the hub on each side of its labels. */
const HUB_PAD = 14;
/** Advance of a JetBrains Mono glyph, in em (font sizes from apps.css). */
const MONO_EM = 0.6;
const BRAND_PX = 20;
const HOST_PX = 10;
const APP = { x: 392, width: 148, height: 40 } as const;

const KEYS: readonly {
	readonly provider: UpstreamProvider;
	readonly label: string;
	readonly cy: number;
}[] = [
	{ provider: "google", label: "Google", cy: 70 },
	{ provider: "github", label: "GitHub", cy: 150 },
	{ provider: "apple", label: "Apple", cy: 230 },
];

/** A smooth horizontal link from (x1, y1) to (x2, y2). */
function link(x1: number, y1: number, x2: number, y2: number): string {
	const mid = (x1 + x2) / 2;
	return `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
}

/** The line itself plus a dashed copy that carries the moving "flow". */
function connector(d: string, tone: string): SafeHtml {
	return html`<path class="hub-line" d="${d}"/><path class="hub-flow tone-${tone}" d="${d}"/>`;
}

function keyNode(key: (typeof KEYS)[number], shift: number): SafeHtml {
	const cy = key.cy + shift;
	const y = cy - KEY.height / 2;
	return html`<g class="hub-node">
<rect x="${KEY.x}" y="${y}" width="${KEY.width}" height="${KEY.height}" rx="10"/>
<svg x="${KEY.x + 12}" y="${cy - 8}" width="16" height="16" viewBox="0 0 24 24"><path class="hub-mark" d="${providerPath(key.provider)}"/></svg>
<text class="hub-text" x="${KEY.x + 38}" y="${cy + 5}">${key.label}</text>
</g>`;
}

function appNode(app: ListedApp, cy: number): SafeHtml {
	const y = cy - APP.height / 2;
	return html`<g class="hub-node tone-${app.tone}">
<rect x="${APP.x}" y="${y}" width="${APP.width}" height="${APP.height}" rx="10"/>
${appIcon(app.icon, { size: 28, x: APP.x + 6, y: y + 6 })}
<text class="hub-text hub-app" x="${APP.x + 42}" y="${cy + 5}">${app.name}</text>
</g>`;
}

/** Height of the view: the default, or more when the apps need it. */
function viewHeight(count: number): number {
	return Math.max(VIEW.height, count * APP_SLOT);
}

/** Vertical centres of the app nodes, spread evenly over the view. */
function appCentres(count: number): number[] {
	const step = viewHeight(count) / count;
	return Array.from({ length: count }, (_, i) => Math.round(step * (i + 0.5)));
}

/** Estimated width of `text` in the monospace font at `px`. */
const monoWidth = (text: string, px: number): number =>
	text.length * px * MONO_EM;

/**
 * A hub label: centred; squeezed with `textLength` only when even the widest
 * hub cannot hold it (a long domain as the tenant's name). Attributes, not
 * styles: CSP allows no inline style, and apps.css sets the font sizes.
 */
function hubLabel(
	text: string,
	px: number,
	cy: number,
	room: number,
	className: string,
): SafeHtml {
	const fit =
		monoWidth(text, px) > room
			? html` textLength="${Math.floor(room)}" lengthAdjust="spacingAndGlyphs"`
			: html``;
	return html`<text class="hub-text ${className}" x="${HUB.cx}" y="${cy}" text-anchor="middle"${fit}>${text}</text>`;
}

/** "A, B and C" in the page's language. */
function appNames(i18n: Translator, apps: readonly ListedApp[]): string {
	return new Intl.ListFormat(i18n.locale, { type: "conjunction" }).format(
		apps.map((app) => app.name),
	);
}

/** `host` is the issuer's host, written under the hub. */
export function hubDiagram(
	i18n: Translator,
	apps: readonly ListedApp[],
	host: string,
): SafeHtml {
	// Keep the providers and the hub centred when the view grows.
	const height = viewHeight(apps.length);
	const shift = (height - VIEW.height) / 2;
	const hubY = HUB.y + shift;
	const hubCy = hubY + HUB.height / 2;
	// The hub grows with the tenant's name and host, within the space
	// between the provider and app columns.
	const natural =
		Math.max(monoWidth(i18n.brand.name, BRAND_PX), monoWidth(host, HOST_PX)) +
		HUB_PAD * 2;
	const hubWidth = Math.min(HUB.maxWidth, Math.max(HUB.minWidth, natural));
	const hubX = HUB.cx - hubWidth / 2;
	const room = hubWidth - HUB_PAD * 2;
	const centres = appCentres(apps.length);
	const inbound = KEYS.map((key) =>
		connector(link(KEY.x + KEY.width, key.cy + shift, hubX, hubCy), "primary"),
	);
	const outbound = apps.map((app, i) =>
		connector(
			link(hubX + hubWidth, hubCy, APP.x, centres[i] ?? hubCy),
			app.tone,
		),
	);
	return html`<svg class="hub" viewBox="0 0 ${VIEW.width} ${height}" role="img" aria-label="${i18n.t("apps.diagram.label", { apps: appNames(i18n, apps) })}" data-id="apps-hub">
${inbound}${outbound}
${KEYS.map((key) => keyNode(key, shift))}
<g class="hub-node hub-core">
<rect x="${hubX}" y="${hubY}" width="${hubWidth}" height="${HUB.height}" rx="16"/>
${hubLabel(i18n.brand.name, BRAND_PX, hubCy - 2, room, "hub-brand")}
${hubLabel(host, HOST_PX, hubCy + 18, room, "hub-sub")}
</g>
${apps.map((app, i) => appNode(app, centres[i] ?? hubCy))}
</svg>`;
}
