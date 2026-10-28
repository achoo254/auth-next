import type { Request, Response } from "express";
import { STATIC_CLIENT_IDS, isStaticClientId } from "../oidc/clients.js";
import type { AppServices } from "../services.js";
import { sendPage } from "../ui/send-page.js";
import {
	type Interaction,
	csrfScope,
	interactionClientId,
	interactionPage,
} from "./interaction-helpers.js";
import { renderLogin, renderSignup } from "./login-page.js";
import { signInProviders } from "./upstream-start.js";

/** 503 while no provider (nor the review sign-in) is configured: no way in at all. */
function pageStatus(services: AppServices): number | undefined {
	return services.upstreams.size === 0 && !services.reviewLogin
		? 503
		: undefined;
}

/** The login page for `interaction`: Google/GitHub buttons and cancel. */
export async function showLogin(
	services: AppServices,
	req: Request,
	res: Response,
	interaction: Interaction,
): Promise<void> {
	const client = await services.provider.Client.find(
		interactionClientId(interaction),
	);
	sendPage(
		res,
		renderLogin({
			page: interactionPage(req, interaction),
			uid: interaction.uid,
			csrf: services.csrf.token(req, res, csrfScope(interaction.uid)),
			providers: signInProviders(services, interaction),
			// The account page is the IdP itself, not an app to "continue to".
			clientName:
				client?.clientId === STATIC_CLIENT_IDS.accountPortal
					? undefined
					: client?.clientName,
			externalClient: client ? !isStaticClientId(client.clientId) : false,
			forDevice: interaction.deviceCode !== undefined,
			reviewLogin: services.reviewLogin !== undefined,
		}),
		pageStatus(services),
	);
}

/**
 * `prompt=create`: the sign-up page. It offers the same Google/GitHub
 * sign-in: an identity no account knows yet goes on to choose a username.
 */
export function showSignup(
	services: AppServices,
	req: Request,
	res: Response,
	interaction: Interaction,
): void {
	sendPage(
		res,
		renderSignup({
			page: interactionPage(req, interaction),
			uid: interaction.uid,
			providers: signInProviders(services, interaction),
		}),
		pageStatus(services),
	);
}
