/**
 * What the Telegram bot says, in the language stored with the chat's link
 * (or the chat's own Telegram language before there is one).
 */
export const enTelegramBot = {
	"bot.start.howTo":
		"To link this chat, open your {brand} account page and press “{button}”. A link expires after 10 minutes and works only once.",
	"bot.link.ask":
		"Link this Telegram chat to {brand} account @{username}? Only confirm if you just opened the link from your account page yourself.",
	"bot.link.confirm": "Confirm link",
	"bot.link.expired":
		"This link has expired or was already used. Create a new one on your {brand} account page.",
	"bot.link.expiredShort": "Link expired",
	"bot.link.otherAccount":
		"This Telegram chat is already linked to another {brand} account. Unlink it there first.",
	"bot.link.otherAccountShort": "Chat linked to another account",
	"bot.link.done":
		"Linked Telegram to {brand} account @{username}. You'll get your account's security notices here.",
	"bot.link.doneShort": "Linked",
	"bot.link.moved":
		"{brand} account @{username} moved its link to another Telegram chat. This chat won't get notices anymore.",
	"bot.notice.providerLinked":
		"{brand} account @{username} was just linked to {provider}. If this wasn't you, unlink it on your account page.",
	"bot.notice.emailReclaimed":
		"Email {email} was removed from {brand} account @{username} because its owner verified it with {provider}. You can still sign in with the Google or GitHub account linked to that account.",
};
