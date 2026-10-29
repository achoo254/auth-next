import { AccountMenu, type AccountMenuEntry } from "@achoo254/app-shell";
import { type ReactElement, createElement } from "react";
import type { AccountDocument } from "../accounts/user-model.js";
import type { PageContext } from "../ui/page-context.js";
import { type AccountIcon, accountIconShape } from "./account-icons.js";
import { ACCOUNT_SECTIONS } from "./account-overview.js";

/**
 * The menu's sign-out: a POST with the portal's CSRF token (the shell's
 * menu signs out by form), answered with a redirect to the IdP's GET
 * end-session page, which asks before signing out. oidc-provider takes no
 * POST there (`enableHttpPostMethods` stays off).
 */
export const ACCOUNT_SIGN_OUT_PATH = "/account/sign-out";

/** A card icon at the menu's 16px, in the shell's icon class. */
function menuIcon(name: AccountIcon): ReactElement {
	return createElement("svg", {
		className: "shell-icon",
		width: 16,
		height: 16,
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		"aria-hidden": true,
		focusable: "false",
		// biome-ignore lint/security/noDangerouslySetInnerHtml: fixed shapes of account-icons.ts, built by the escaping `html` template
		dangerouslySetInnerHTML: { __html: accountIconShape(name).value },
	});
}

/** One group per section of /account, one link per card, as in its nav. */
function sectionEntries(page: PageContext): AccountMenuEntry[][] {
	return ACCOUNT_SECTIONS.map((section) =>
		section.cards.map((card) => ({
			label: page.i18n.t(card.title),
			dataId: `account-menu-${card.id}`,
			href: `/account#account-${card.id}`,
			icon: menuIcon(card.icon),
		})),
	);
}

/**
 * The header's account menu on /account pages: the account's picture (or
 * initial), name (else username) and email, links to the sections of
 * /account, and sign-out (`ACCOUNT_SIGN_OUT_PATH`). No IdP group: this is
 * the IdP.
 */
export function portalAccountMenu(
	page: PageContext,
	account: AccountDocument,
	csrf: string,
): ReactElement {
	const { i18n } = page;
	return createElement(AccountMenu, {
		user: {
			name: account.name?.trim() || account.username,
			email: account.email,
			picture: account.picture,
		},
		locale: i18n.locale,
		domain: i18n.brand.domain,
		idpAccountUrl: null,
		entries: sectionEntries(page),
		signOut: { action: ACCOUNT_SIGN_OUT_PATH, fields: { csrf } },
	});
}
