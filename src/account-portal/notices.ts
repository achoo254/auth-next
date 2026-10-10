import type { MessageKey } from "../i18n/dictionaries.js";
import type { AlertTone } from "../ui/components.js";

interface Notice {
	readonly tone: AlertTone;
	readonly text: MessageKey;
}

/** Messages shown on /account after a redirect (`?notice=<key>`). */
const NOTICES: Readonly<Record<string, Notice>> = {
	reauthed: { tone: "info", text: "notice.reauthed" },
	expired: { tone: "error", text: "notice.expired" },
	profile: { tone: "success", text: "notice.profile" },
	"linked-google": { tone: "success", text: "notice.linkedGoogle" },
	"linked-github": { tone: "success", text: "notice.linkedGithub" },
	unlinked: { tone: "success", text: "notice.unlinked" },
	"last-method": { tone: "error", text: "notice.lastMethod" },
	"telegram-unlinked": { tone: "success", text: "notice.telegramUnlinked" },
	"session-revoked": { tone: "success", text: "notice.sessionRevoked" },
	"sessions-revoked": { tone: "success", text: "notice.otherSessionsRevoked" },
	"device-revoked": { tone: "success", text: "notice.deviceRevoked" },
	"app-revoked": { tone: "success", text: "notice.appRevoked" },
	"not-found": { tone: "error", text: "notice.notFound" },
};

/**
 * A Map, so a crafted `?notice=` such as "constructor" or "__proto__" can
 * never reach an inherited property.
 */
export const ACCOUNT_NOTICES: ReadonlyMap<string, Notice> = new Map(
	Object.entries(NOTICES),
);
