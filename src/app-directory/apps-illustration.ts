import type { UpstreamProvider } from "../accounts/user-model.js";
import type { Translator } from "../i18n/translator.js";
import { type SafeHtml, html } from "../ui/html.js";
import { providerPath } from "../ui/provider-logos.js";
import { type ListedApp, appIcon } from "./apps-catalog.js";

/*
 * The hero diagram: Google and GitHub lead into one hoandat account, which
 * fans out to every app. Pure SVG in currentColor and token classes
 * (apps.css); the moving dashes are CSS and stop under reduced motion.
 */

const VIEW = { width: 544, height: 300 } as const;
const KEY = { x: 8, width: 124, height: 40 } as const;
const HUB = { x: 196, y: 110, width: 128, height: 80 } as const;
const APP = { x: 392, width: 148, height: 40 } as const;

const KEYS: readonly {
	readonly provider: UpstreamProvider;
	readonly label: string;
	readonly cy: number;
}[] = [
	{ provider: "google", label: "Google", cy: 110 },
	{ provider: "github", label: "GitHub", cy: 190 },
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

function keyNode(key: (typeof KEYS)[number]): SafeHtml {
	const y = key.cy - KEY.height / 2;
	return html`<g class="hub-node">
<rect x="${KEY.x}" y="${y}" width="${KEY.width}" height="${KEY.height}" rx="10"/>
<svg x="${KEY.x + 12}" y="${key.cy - 8}" width="16" height="16" viewBox="0 0 24 24"><path class="hub-mark" d="${providerPath(key.provider)}"/></svg>
<text class="hub-text" x="${KEY.x + 38}" y="${key.cy + 5}">${key.label}</text>
</g>`;
}

function appNode(app: ListedApp, cy: number): SafeHtml {
	const y = cy - APP.height / 2;
	return html`<g class="hub-node tone-${app.tone}">
<rect x="${APP.x}" y="${y}" width="${APP.width}" height="${APP.height}" rx="10"/>
<rect class="hub-chip" x="${APP.x + 6}" y="${y + 6}" width="28" height="28" rx="7"/>
${appIcon(app.icon, { size: 16, x: APP.x + 12, y: y + 12 })}
<text class="hub-text hub-app" x="${APP.x + 42}" y="${cy + 5}">${app.name}</text>
</g>`;
}

/** Vertical centres of the app nodes, spread evenly over the view. */
function appCentres(count: number): number[] {
	const step = VIEW.height / count;
	return Array.from({ length: count }, (_, i) => Math.round(step * (i + 0.5)));
}

/** `host` is the issuer's host, written under the hub. */
export function hubDiagram(
	i18n: Translator,
	apps: readonly ListedApp[],
	host: string,
): SafeHtml {
	const hubCy = HUB.y + HUB.height / 2;
	const centres = appCentres(apps.length);
	const inbound = KEYS.map((key) =>
		connector(link(KEY.x + KEY.width, key.cy, HUB.x, hubCy), "primary"),
	);
	const outbound = apps.map((app, i) =>
		connector(
			link(HUB.x + HUB.width, hubCy, APP.x, centres[i] ?? hubCy),
			app.tone,
		),
	);
	return html`<svg class="hub" viewBox="0 0 ${VIEW.width} ${VIEW.height}" role="img" aria-label="${i18n.t("apps.diagram.label")}" data-id="apps-hub">
${inbound}${outbound}
${KEYS.map(keyNode)}
<g class="hub-node hub-core">
<rect x="${HUB.x}" y="${HUB.y}" width="${HUB.width}" height="${HUB.height}" rx="16"/>
<text class="hub-text hub-brand" x="${HUB.x + HUB.width / 2}" y="${hubCy - 2}" text-anchor="middle">hoandat</text>
<text class="hub-text hub-sub" x="${HUB.x + HUB.width / 2}" y="${hubCy + 18}" text-anchor="middle">${host}</text>
</g>
${apps.map((app, i) => appNode(app, centres[i] ?? hubCy))}
</svg>`;
}
