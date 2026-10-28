import type { Request, Response } from "express";
import { loadPortalContext } from "../account-portal/portal-session.js";
import {
	type UpstreamProfile,
	linkUpstream,
} from "../accounts/account-linking.js";
import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import { notifyAccount } from "../push/notify-account.js";
import type { AppServices } from "../services.js";
import { sendInteractionError } from "./interaction-helpers.js";

/**
 * Callback of "Link Google/GitHub" on /account: the same browser must
 * still be signed in as the account that started it, and the provider
 * account must not belong to someone else.
 */
export async function finishAccountLink(
	services: AppServices,
	req: Request,
	res: Response,
	link: {
		readonly accountId: string;
		/** Security version the link state was checked at. */
		readonly version: number;
		readonly profile: UpstreamProfile;
	},
): Promise<void> {
	const { accountId, profile } = link;
	const label = UPSTREAM_LABELS[profile.provider];
	const expired = {
		message: "upstream.expired",
		params: { provider: label },
	} as const;
	const toAccount = {
		href: "/account",
		label: "common.backToAccount",
	} as const;
	const portal = await loadPortalContext(services, req, res);
	if (!portal || portal.account._id !== accountId) {
		sendInteractionError(res, expired);
		return;
	}
	const owner = await services.accounts.findByProvider(
		profile.provider,
		profile.providerId,
	);
	if (owner && owner._id !== portal.account._id) {
		sendInteractionError(res, {
			message: "upstream.link.ownedByOther",
			params: { provider: label },
			status: 409,
			back: toAccount,
		});
		return;
	}
	if (portal.account.providers[profile.provider]) {
		sendInteractionError(res, {
			message: "upstream.link.alreadyLinked",
			params: { provider: label },
			status: 409,
			back: toAccount,
		});
		return;
	}
	const write = await linkUpstream(
		services.accounts,
		portal.account,
		profile,
		link.version,
	);
	if (!write.applied) {
		sendInteractionError(res, { ...expired, status: 410 });
		return;
	}
	notifyAccount(services, portal.account, {
		kind: "provider-linked",
		provider: profile.provider,
	});
	services.logger.info(
		{ accountId: portal.account._id, provider: profile.provider },
		"Provider linked",
	);
	res.redirect(303, `/account?notice=linked-${profile.provider}`);
}
