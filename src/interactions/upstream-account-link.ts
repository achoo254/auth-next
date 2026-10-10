import type { Request, Response } from "express";
import { loadPortalContext } from "../account-portal/portal-session.js";
import {
	type UpstreamProfile,
	linkUpstream,
} from "../accounts/account-linking.js";
import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import type { AppServices } from "../services.js";
import { notifyTelegram } from "../telegram/notify.js";
import { sendInteractionError } from "./interaction-helpers.js";

/**
 * Callback of "Liên kết Google/GitHub" on /account: the same browser must
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
	const expired = `Phiên đăng nhập bằng ${label} đã hết hạn. Thử lại từ đầu.`;
	const portal = await loadPortalContext(services, req, res);
	if (!portal || portal.account._id !== accountId) {
		sendInteractionError(services, res, expired);
		return;
	}
	const owner = await services.accounts.findByProvider(
		profile.provider,
		profile.providerId,
	);
	if (owner && owner._id !== portal.account._id) {
		sendInteractionError(
			services,
			res,
			`Tài khoản ${label} này đã liên kết với một tài khoản hoandat khác.`,
			409,
			{ href: "/account", label: "Về trang tài khoản" },
		);
		return;
	}
	if (portal.account.providers[profile.provider]) {
		sendInteractionError(
			services,
			res,
			`Tài khoản đã liên kết một tài khoản ${label} khác. Huỷ liên kết đó trước.`,
			409,
			{ href: "/account", label: "Về trang tài khoản" },
		);
		return;
	}
	const write = await linkUpstream(
		services.accounts,
		portal.account,
		profile,
		link.version,
	);
	if (!write.applied) {
		sendInteractionError(services, res, expired, 410);
		return;
	}
	notifyTelegram(
		services,
		portal.account,
		`Tài khoản hoandat @${portal.account.username} vừa được liên kết với ${label}. Nếu không phải bạn, hãy huỷ liên kết ở trang tài khoản.`,
	);
	services.logger.info(
		{ accountId: portal.account._id, provider: profile.provider },
		"Provider linked",
	);
	res.redirect(303, `/account?notice=linked-${profile.provider}`);
}
