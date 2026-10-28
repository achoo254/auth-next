import { STATIC_CLIENT_IDS, isStaticClientId } from "../oidc/clients.js";

const ids = STATIC_CLIENT_IDS;

/**
 * The IdP's own clients (/account and the iOS account app). Signing in to
 * them is managing the account, not using an app, so the app metrics of
 * the growth report leave them out; the per-client counts still list them.
 */
export const IDP_OWN_CLIENT_IDS: readonly string[] = [
	ids.accountPortal,
	ids.accountIos,
];

/** Web, mobile and development clients of one product count as one app. */
const APP_OF_STATIC_CLIENT: Readonly<Record<string, string>> = {
	[ids.localmanWeb]: "localman",
	[ids.tuneloCli]: "tunelo",
	[ids.tuneloWeb]: "tunelo",
	[ids.chatWeb]: "chat",
	[ids.chatMobile]: "chat",
	[ids.scribeWeb]: "scribe",
	[ids.scribeMobile]: "scribe",
	[ids.scribeWebDev]: "scribe",
	[ids.miuWeb]: "miu",
	[ids.miuMobile]: "miu",
	[ids.miuWebDev]: "miu",
	[ids.tieudeWeb]: "tieude",
	[ids.tuviWeb]: "tuvi",
	[ids.clipWeb]: "clip",
	[ids.webnhanhWeb]: "webnhanh",
};

/**
 * The app a client belongs to, or undefined for the IdP's own clients.
 * Every client that is not static registered itself (DCR) for Localman's
 * MCP resource, so it is Localman. A static client added later without an
 * entry above counts as an app named after its client id.
 */
export function appOfClient(clientId: string): string | undefined {
	if (IDP_OWN_CLIENT_IDS.includes(clientId)) return undefined;
	if (!isStaticClientId(clientId)) return "localman";
	return APP_OF_STATIC_CLIENT[clientId] ?? clientId;
}

/** How many distinct apps `clientIds` belong to (the IdP's own left out). */
export function appCount(clientIds: readonly string[]): number {
	const apps = new Set<string>();
	for (const clientId of clientIds) {
		const app = appOfClient(clientId);
		if (app !== undefined) apps.add(app);
	}
	return apps.size;
}
