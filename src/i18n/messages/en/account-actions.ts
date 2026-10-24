/** /account notices, confirmation pages and the Telegram link page. */
export const enAccountActions = {
	"notice.reauthed":
		"Identity confirmed. Repeat what you were doing within the next 10 minutes.",
	"notice.expired": "The form expired. Try again.",
	"notice.profile": "Profile saved.",
	"notice.linkedGoogle": "Linked Google.",
	"notice.linkedGithub": "Linked GitHub.",
	"notice.linkedApple": "Linked Apple.",
	"notice.unlinked": "Unlinked.",
	"notice.lastMethod":
		"Couldn't unlink: it's your account's last way to sign in. Link the other of Google or GitHub first.",
	"notice.telegramUnlinked": "Unlinked Telegram.",
	"notice.sessionRevoked": "Signed out the session.",
	"notice.otherSessionsRevoked": "Signed out every other session.",
	"notice.deviceRevoked": "Signed out the device.",
	"notice.appRevoked": "Removed the app's access.",
	"notice.notFound": "Couldn't find what you wanted to remove.",
	"notice.deleteMismatch":
		"The username didn't match. Your account was not deleted.",
	"confirm.delete.title": "Delete your {brand} account?",
	"confirm.delete.lead":
		"Account {username} and everything tied to it at {brand} are deleted right away. This cannot be undone.",
	"confirm.delete.signOut":
		"Every session, device and app you allowed is signed out; you can no longer sign in to Localman, Tunelo or Chat with this account.",
	"confirm.delete.providers":
		"Your Google, GitHub, Apple and Telegram links are removed. Signing in again later creates a new, different account.",
	"confirm.delete.appData":
		"Data you keep inside the apps that use this account (such as Localman projects and Chat messages) is not deleted by this step.",
	"confirm.delete.securityLog":
		"The security log keeps only the event type, its time and the account ID; no IP address, browser or device name.",
	"confirm.delete.typeUsername": "Type {username} to confirm",
	"confirm.delete.button": "Delete account permanently",
	"deleted.title": "Account deleted",
	"deleted.body":
		"Your {brand} account and the data tied to it have been deleted.",
	"confirm.app.title": "Remove app access?",
	"confirm.app.lead":
		"{app} will no longer be able to use your {brand} account.",
	"confirm.app.canNow": "It can currently:",
	"confirm.app.effect":
		"Its sign-ins and tokens stop working, and it must ask you again to get access. Access tokens it already holds expire within 15 minutes.",
	"confirm.sessions.title": "Sign out every other session?",
	"confirm.sessions.lead":
		"Every browser below is signed out of your {brand} account. This browser stays signed in.",
	"confirm.sessions.effect":
		"Apps signed in through those browsers, such as Localman and Tunelo on the web, are signed out too. Devices (the Tunelo CLI and phone apps) stay signed in.",
	"telegram.title": "Link Telegram",
	"telegram.subtitle":
		"Open the {brand} bot in Telegram, press Start, then press “{button}” within 10 minutes.",
	"telegram.open": "Open Telegram",
	"telegram.orSend": "Or send this command to the bot {bot}:",
	"telegram.commandLabel": "Link command",
	"telegram.once":
		"The link works once. After the bot says the chat is linked, reload your account page.",
};
