import type { Request, Response } from "express";
import type { UpstreamProfile } from "../accounts/account-linking.js";
import { isUpstreamProvider } from "../accounts/user-model.js";
import type { AppServices } from "../services.js";
import {
	type Interaction,
	isSignInPrompt,
	loadInteraction,
} from "./interaction-helpers.js";
import { completeLogin } from "./security-review-routes.js";

const PENDING_TTL_SECONDS = 10 * 60;

/**
 * A Google/GitHub profile waiting for the rest of its interaction (password
 * to link, or a username). Keyed by interaction uid; only the browser that
 * holds that interaction's cookie can reach the pages that read it.
 */
export async function savePendingUpstream(
	services: AppServices,
	uid: string,
	profile: UpstreamProfile,
): Promise<void> {
	const data: Record<string, string> = {
		provider: profile.provider,
		providerId: profile.providerId,
	};
	if (profile.verifiedEmail) data.verifiedEmail = profile.verifiedEmail;
	if (profile.name) data.name = profile.name;
	if (profile.picture) data.picture = profile.picture;
	await services.tokens.put("upstream-pending", uid, data, PENDING_TTL_SECONDS);
}

function toProfile(
	data: Record<string, string> | undefined,
): UpstreamProfile | undefined {
	if (!data || !isUpstreamProvider(data.provider) || !data.providerId) {
		return undefined;
	}
	return {
		provider: data.provider,
		providerId: data.providerId,
		verifiedEmail: data.verifiedEmail,
		name: data.name,
		picture: data.picture,
	};
}

export async function peekPendingUpstream(
	services: AppServices,
	uid: string,
): Promise<UpstreamProfile | undefined> {
	return toProfile(await services.tokens.peek("upstream-pending", uid));
}

export async function dropPendingUpstream(
	services: AppServices,
	uid: string,
): Promise<void> {
	await services.tokens.take("upstream-pending", uid);
}

/** Signs in through the provider and forgets the pending profile. */
export async function finishUpstream(
	services: AppServices,
	req: Request,
	res: Response,
	interaction: Interaction,
	accountId: string,
): Promise<void> {
	await dropPendingUpstream(services, interaction.uid);
	await completeLogin(services, req, res, interaction, accountId, ["fed"]);
}

/** Loads the interaction and its pending Google/GitHub profile. */
export async function loadPending(
	services: AppServices,
	req: Request,
	res: Response,
): Promise<{ interaction: Interaction; profile: UpstreamProfile } | undefined> {
	const interaction = await loadInteraction(services, req, res);
	if (!interaction) return undefined;
	const profile = await peekPendingUpstream(services, interaction.uid);
	if (!profile || !isSignInPrompt(interaction)) {
		res.redirect(303, `/interaction/${interaction.uid}`);
		return undefined;
	}
	return { interaction, profile };
}
