import type { Response } from "express";
import { z } from "zod";
import {
	type UpstreamProfile,
	linkUpstream,
} from "../accounts/account-linking.js";
import { randomToken } from "../accounts/one-time-tokens.js";
import {
	UPSTREAM_PROVIDERS,
	type UpstreamProvider,
} from "../accounts/user-model.js";
import { IOS_LINKED_PATH } from "../oidc/account-ios-client.js";
import { notifyAccount } from "../push/notify-account.js";
import type { AppServices } from "../services.js";

/**
 * The second half of linking from the app. The browser sheet that went
 * through the provider is not trusted to link: its URL can be handed to
 * someone else, whose provider account would then land in the URL
 * creator's account. So the callback only holds what the provider proved,
 * under a random `ref` bound to the account and the app grant that asked,
 * and the link happens when that same grant confirms the `ref` over the
 * API (`POST /api/account/providers/:provider/link/complete`). The `ref`
 * reaches the app only through the sheet's own redirect to /ios/linked.
 */
const RESULT_TTL_SECONDS = 5 * 60;

export type AppLinkCompletion =
	| "linked"
	| "owned_by_other"
	| "already_linked"
	| "expired"
	| "failed";

const heldProfile = z.object({
	provider: z.enum(UPSTREAM_PROVIDERS),
	providerId: z.string().min(1),
	verifiedEmail: z.string().optional(),
	login: z.string().optional(),
	name: z.string().optional(),
	picture: z.string().optional(),
	revocationToken: z.string().optional(),
});

/**
 * Callback side: keeps the provider's answer for five minutes (account-
 * bound, so any security change of the account voids it) and sends the
 * sheet to /ios/linked?result=pending&ref=…
 */
export async function holdAppLinkResult(
	services: AppServices,
	res: Response,
	link: {
		readonly accountId: string;
		readonly grantId: string;
		/** Security version the link state was checked at. */
		readonly version: number;
		readonly profile: UpstreamProfile;
	},
): Promise<void> {
	const { profile } = link;
	const ref = randomToken();
	const held = await services.accountTokens.issue(
		"app-link-result",
		ref,
		link.accountId,
		{
			grantId: link.grantId,
			stateVersion: String(link.version),
			provider: profile.provider,
			profile: JSON.stringify(heldProfile.parse(profile)),
		},
		RESULT_TTL_SECONDS,
	);
	const url = new URL(IOS_LINKED_PATH, services.issuer);
	url.searchParams.set("result", held ? "pending" : "expired");
	url.searchParams.set("provider", profile.provider);
	if (held) url.searchParams.set("ref", ref);
	res.redirect(303, url.href);
}

function parseHeld(text: string | undefined): UpstreamProfile | undefined {
	try {
		const parsed = heldProfile.safeParse(JSON.parse(text ?? ""));
		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
}

/**
 * API side: undefined (answered `not_found`) unless `ref` is a held result
 * of this provider for this account and this very app grant; it is only
 * used up then. The link itself runs every check of the web's: the provider
 * account belongs to no one else, it is not linked yet, and the write is
 * conditioned on the security version the link state was issued at.
 */
export async function completeAppLink(
	services: AppServices,
	caller: { readonly accountId: string; readonly grantId: string },
	provider: UpstreamProvider,
	ref: string,
): Promise<AppLinkCompletion | undefined> {
	const found = await services.accountTokens.peek("app-link-result", ref);
	if (found.status === "missing") return undefined;
	if (found.status === "stale") {
		// A security change since: void, whoever presents it.
		await services.accountTokens.take("app-link-result", ref);
		return "expired";
	}
	if (
		found.account._id !== caller.accountId ||
		found.data.grantId !== caller.grantId ||
		found.data.provider !== provider
	) {
		return undefined;
	}
	const taken = await services.accountTokens.take("app-link-result", ref);
	if (taken.status !== "ok") return "expired";
	const profile = parseHeld(taken.data.profile);
	if (!profile || profile.provider !== provider) return "failed";
	if (String(taken.version) !== taken.data.stateVersion) return "expired";
	const account = taken.account;
	const owner = await services.accounts.findByProvider(
		provider,
		profile.providerId,
	);
	if (owner && owner._id !== account._id) return "owned_by_other";
	if (account.providers[provider]) return "already_linked";
	const write = await linkUpstream(
		services.accounts,
		account,
		profile,
		taken.version,
	);
	if (!write.applied) return "expired";
	notifyAccount(
		services,
		account,
		{ kind: "provider-linked", provider },
		{ exceptGrantId: caller.grantId },
	);
	services.logger.info(
		{ accountId: account._id, provider },
		"Provider linked from the app",
	);
	return "linked";
}
