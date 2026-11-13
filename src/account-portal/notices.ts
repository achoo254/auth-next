import type { MessageKey } from "../i18n/dictionaries.js";
import type { AlertTone } from "../ui/components.js";
import type { AccountCardId } from "./account-overview.js";

interface Notice {
	readonly tone: AlertTone;
	readonly text: MessageKey;
	/** The card the action was on: the notice shows above it, not on top. */
	readonly card?: AccountCardId;
}

/** Messages shown on /account after a redirect (`?notice=<key>`). */
const NOTICES: Readonly<Record<string, Notice>> = {
	reauthed: { tone: "info", text: "notice.reauthed" },
	expired: { tone: "error", text: "notice.expired" },
	profile: { tone: "success", text: "notice.profile", card: "profile" },
	"linked-google": {
		tone: "success",
		text: "notice.linkedGoogle",
		card: "sign-in",
	},
	"linked-github": {
		tone: "success",
		text: "notice.linkedGithub",
		card: "sign-in",
	},
	"linked-apple": {
		tone: "success",
		text: "notice.linkedApple",
		card: "sign-in",
	},
	unlinked: { tone: "success", text: "notice.unlinked", card: "sign-in" },
	"last-method": { tone: "error", text: "notice.lastMethod", card: "sign-in" },
	"telegram-unlinked": {
		tone: "success",
		text: "notice.telegramUnlinked",
		card: "telegram",
	},
	"chat-notices-on": {
		tone: "success",
		text: "notice.chatNoticesOn",
		card: "telegram",
	},
	"chat-notices-off": {
		tone: "success",
		text: "notice.chatNoticesOff",
		card: "telegram",
	},
	"session-revoked": {
		tone: "success",
		text: "notice.sessionRevoked",
		card: "sessions",
	},
	"sessions-revoked": {
		tone: "success",
		text: "notice.otherSessionsRevoked",
		card: "sessions",
	},
	"device-revoked": {
		tone: "success",
		text: "notice.deviceRevoked",
		card: "sessions",
	},
	"app-revoked": { tone: "success", text: "notice.appRevoked", card: "apps" },
	"not-found": { tone: "error", text: "notice.notFound" },
	"delete-mismatch": { tone: "error", text: "notice.deleteMismatch" },
};

/**
 * A Map, so a crafted `?notice=` such as "constructor" or "__proto__" can
 * never reach an inherited property.
 */
export const ACCOUNT_NOTICES: ReadonlyMap<string, Notice> = new Map(
	Object.entries(NOTICES),
);

/** Where the page shows a notice tied to a card; the URL jumps there. */
export const NOTICE_ANCHOR = "account-notice";

/**
 * /account with a notice: for an action on one card, the page opens on
 * that card with the notice just above it, so a full reload after a button
 * does not lose the place.
 */
export function accountNoticePath(key: string): string {
	const card = ACCOUNT_NOTICES.get(key)?.card;
	return `/account?notice=${encodeURIComponent(key)}${card ? `#${NOTICE_ANCHOR}` : ""}`;
}
