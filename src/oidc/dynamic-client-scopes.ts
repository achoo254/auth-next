import type Provider from "oidc-provider";
import type { KoaContextWithOIDC } from "oidc-provider";
import { normalizeRoutePath } from "../http/route-path.js";
import { isStaticClientId } from "./clients.js";

export const OFFLINE_ACCESS_SCOPE = "offline_access";

/**
 * MCP SDKs add `offline_access` to registration and authorization requests
 * whenever discovery lists it. A DCR (MCP) client never holds it: its refresh
 * tokens are bound to the IdP session instead (`refreshesWithSession`), so
 * the value is dropped rather than refused, which would break the client at
 * its first step. Nothing else is filtered here.
 */
export function withoutOfflineAccess(scopes: readonly string[]): string[] {
	return scopes.filter((scope) => scope !== OFFLINE_ACCESS_SCOPE);
}

/**
 * Rewrites the query of a GET authorization request from a DCR client so it
 * no longer asks for `offline_access`. Without this, oidc-provider answers
 * `scope=... offline_access&prompt=consent` (what MCP SDKs send) with
 * `invalid_scope`, since the client's registered scope never contains it.
 * Requests with a missing or repeated `client_id`/`scope` are left for the
 * provider to judge.
 */
function stripOfflineAccessFromQuery(ctx: KoaContextWithOIDC): void {
	const query = new URLSearchParams(ctx.querystring);
	const clientIds = query.getAll("client_id");
	const scopeValues = query.getAll("scope");
	if (clientIds.length !== 1 || scopeValues.length !== 1) return;
	const [clientId] = clientIds;
	const [scope] = scopeValues;
	if (clientId === undefined || scope === undefined) return;
	if (isStaticClientId(clientId)) return;

	const requested = scope.split(" ").filter(Boolean);
	if (!requested.includes(OFFLINE_ACCESS_SCOPE)) return;
	const kept = withoutOfflineAccess(requested);
	if (kept.length > 0) {
		query.set("scope", kept.join(" "));
	} else {
		query.delete("scope");
	}
	ctx.querystring = query.toString();
}

/**
 * Applies the rule above at the authorization endpoint, before the provider
 * reads the request. MCP clients open the authorization URL in a browser
 * (GET); POST and pushed authorization requests are not rewritten, since
 * their body must reach oidc-provider unparsed.
 */
export function ignoreOfflineAccessOfDynamicClients(
	provider: Provider,
	authorizationPath: string,
): void {
	const path = normalizeRoutePath(authorizationPath);
	provider.use(async (ctx: KoaContextWithOIDC, next: () => Promise<void>) => {
		if (ctx.method === "GET" && normalizeRoutePath(ctx.path) === path) {
			stripOfflineAccessFromQuery(ctx);
		}
		await next();
	});
}
