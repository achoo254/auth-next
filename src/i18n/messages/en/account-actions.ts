/** /account notices, confirmation pages and the Telegram link page. */
export const enAccountActions = {
	"notice.reauthed":
		"Identity confirmed. Repeat what you were doing within the next 10 minutes.",
	"notice.expired": "The form expired. Try again.",
	"notice.profile": "Profile saved.",
	"notice.linkedGoogle": "Linked Google.",
	"notice.linkedGithub": "Linked GitHub.",
	"notice.unlinked": "Unlinked.",
	"notice.lastMethod":
		"Couldn't unlink: it's your account's last way to sign in. Link the other of Google or GitHub first.",
	"notice.telegramUnlinked": "Unlinked Telegram.",
	"notice.sessionRevoked": "Signed out the session.",
	"notice.otherSessionsRevoked": "Signed out every other session.",
	"notice.deviceRevoked": "Signed out the device.",
	"notice.appRevoked": "Removed the app's access.",
	"notice.notFound": "Couldn't find what you wanted to remove.",
	"confirm.app.title": "Remove app access?",
	"confirm.app.lead":
		"{app} will no longer be able to use your hoandat account.",
	"confirm.app.canNow": "It can currently:",
	"confirm.app.effect":
		"Its sign-ins and tokens stop working, and it must ask you again to get access. Access tokens it already holds expire within 15 minutes.",
	"confirm.sessions.title": "Sign out every other session?",
	"confirm.sessions.lead":
		"Every browser below is signed out of your hoandat account. This browser stays signed in.",
	"confirm.sessions.effect":
		"Apps signed in through those browsers, such as Localman and Tunelo on the web, are signed out too. Tunelo devices stay signed in.",
	"telegram.title": "Link Telegram",
	"telegram.subtitle":
		"Open the hoandat bot in Telegram, press Start, then press “Xác nhận liên kết” (confirm link) within 10 minutes.",
	"telegram.open": "Open Telegram",
	"telegram.orSend": "Or send this command to the bot {bot}:",
	"telegram.commandLabel": "Link command",
	"telegram.once":
		"The link works once. After the bot says the chat is linked, reload your account page.",
};
