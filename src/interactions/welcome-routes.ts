import type { Request, Response, Router } from "express";
import type { UpstreamProfile } from "../accounts/account-linking.js";
import { STATIC_CLIENT_IDS, isStaticClientId } from "../oidc/clients.js";
import type { AppServices } from "../services.js";
import { sendPage } from "../ui/send-page.js";
import {
	type Interaction,
	asyncHandler,
	checkCsrf,
	csrfScope,
	finishLogin,
	interactionClientId,
	interactionPage,
	isSignInPrompt,
	loadInteraction,
} from "./interaction-helpers.js";
import {
	dropPendingUpstream,
	finishUpstream,
	upstreamAmr,
} from "./upstream-pending.js";
import { heroApps, renderWelcome } from "./welcome-page.js";

/** As long as the interaction itself lives (oidc-provider's Interaction TTL). */
const WELCOME_TTL_SECONDS = 30 * 60;

/**
 * Our own phone apps sign in inside an in-app browser sheet, where a link
 * to another app would leave the sign-in. A device login (tunelo login)
 * and third-party apps use a full browser.
 */
async function signsInInAppSheet(
	services: AppServices,
	interaction: Interaction,
): Promise<boolean> {
	const clientId = interactionClientId(interaction);
	if (interaction.deviceCode !== undefined || !isStaticClientId(clientId)) {
		return false;
	}
	const client = await services.provider.Client.find(clientId);
	return client?.applicationType === "native";
}

/**
 * Right after `accountId` was created in this interaction: holds its
 * sign-in server-side (keyed by the interaction uid, never by anything the
 * browser sends) and shows the welcome screen. Its button finishes the
 * sign-in through finishLogin. Our phone apps and a tenant with no hero app
 * configured finish at once, as before.
 */
export async function welcomeNewAccount(
	services: AppServices,
	req: Request,
	res: Response,
	interaction: Interaction,
	accountId: string,
	profile: UpstreamProfile,
): Promise<void> {
	if (
		heroApps(services.tenant).length === 0 ||
		(await signsInInAppSheet(services, interaction))
	) {
		await finishUpstream(services, req, res, interaction, accountId, profile);
		return;
	}
	await dropPendingUpstream(services, interaction.uid);
	await services.tokens.put(
		"welcome-pending",
		interaction.uid,
		{ accountId, amr: upstreamAmr(profile).join(" ") },
		WELCOME_TTL_SECONDS,
	);
	res.redirect(303, `/interaction/${interaction.uid}/welcome`);
}

/** The held sign-in, or undefined when there is none for this interaction. */
function heldSignIn(
	data: Record<string, string> | undefined,
): { accountId: string; amr: string[] } | undefined {
	const amr = data?.amr?.split(" ").filter(Boolean) ?? [];
	return data?.accountId && amr.length > 0
		? { accountId: data.accountId, amr }
		: undefined;
}

/**
 * The name the continue button gives the app: first-party apps only (a
 * DCR client's self-declared name is not vouched for here), and not the
 * account page, which is this IdP rather than an app to continue to.
 */
async function continueTarget(
	services: AppServices,
	interaction: Interaction,
): Promise<string | undefined> {
	const clientId = interactionClientId(interaction);
	if (!isStaticClientId(clientId)) return undefined;
	if (clientId === STATIC_CLIENT_IDS.accountPortal) return undefined;
	const client = await services.provider.Client.find(clientId);
	return client?.clientName ?? undefined;
}

/** GET and POST /interaction/:uid/welcome. */
export function registerWelcomeRoutes(
	router: Router,
	services: AppServices,
): void {
	router.get(
		"/:uid/welcome",
		asyncHandler(async (req, res) => {
			const interaction = await loadInteraction(services, req, res);
			if (!interaction) return;
			const held = heldSignIn(
				await services.tokens.peek("welcome-pending", interaction.uid),
			);
			if (!held || !isSignInPrompt(interaction)) {
				res.redirect(303, `/interaction/${interaction.uid}`);
				return;
			}
			sendPage(
				res,
				renderWelcome({
					page: interactionPage(req, interaction),
					uid: interaction.uid,
					csrf: services.csrf.token(req, res, csrfScope(interaction.uid)),
					apps: heroApps(services.tenant),
					clientName: await continueTarget(services, interaction),
				}),
			);
		}),
	);

	router.post(
		"/:uid/welcome",
		asyncHandler(async (req, res) => {
			const interaction = await loadInteraction(services, req, res);
			if (!interaction) return;
			if (!checkCsrf(services, req, res, csrfScope(interaction.uid))) return;
			if (!isSignInPrompt(interaction)) {
				res.redirect(303, `/interaction/${interaction.uid}`);
				return;
			}
			const held = heldSignIn(
				await services.tokens.take("welcome-pending", interaction.uid),
			);
			if (!held) {
				res.redirect(303, `/interaction/${interaction.uid}`);
				return;
			}
			await finishLogin(services, req, res, held.accountId, held.amr);
		}),
	);
}
