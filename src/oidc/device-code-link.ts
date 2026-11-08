import type Provider from "oidc-provider";
import type { KoaContextWithOIDC } from "oidc-provider";
import { normalizeRoutePath } from "../http/route-path.js";
import { TUNELO_AGENT_CLIENT_ID } from "./resources.js";

const COMPLETE_URI = "verification_uri_complete";

/**
 * The Tunelo agent's device code must be typed by the user, so its device
 * authorization response carries no `verification_uri_complete` (the link
 * with the code filled in, which is what a phishing message would send).
 * The verification page refuses the prefilled code for it as well
 * (`userCodeConfirmSource`). Every other client keeps the link.
 */
export function dropPrefilledCodeLinkOfAgent(
	provider: Provider,
	deviceAuthorizationPath: string,
): void {
	const path = normalizeRoutePath(deviceAuthorizationPath);
	provider.use(async (ctx: KoaContextWithOIDC, next: () => Promise<void>) => {
		await next();
		if (normalizeRoutePath(ctx.path) !== path) return;
		if (ctx.oidc?.client?.clientId !== TUNELO_AGENT_CLIENT_ID) return;
		const body: unknown = ctx.body;
		if (typeof body === "object" && body !== null && COMPLETE_URI in body) {
			Reflect.deleteProperty(body, COMPLETE_URI);
		}
	});
}
