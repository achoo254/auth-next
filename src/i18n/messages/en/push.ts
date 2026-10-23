/**
 * Push notices of the iOS account app. Lock screens show them, so they name
 * no email, address, code or link: only what happened, and at most a
 * provider or a first-party app's name.
 */
export const enPush = {
	"push.newSignIn.title": "New sign-in",
	"push.newSignIn.body":
		"Your {brand} account was just signed in to. If this wasn't you, open the app and sign it out.",
	"push.providerLinked.title": "Sign-in method added",
	"push.providerLinked.body":
		"{provider} can now sign in to your {brand} account. If this wasn't you, unlink it in the app.",
	"push.providerUnlinked.title": "Sign-in method removed",
	"push.providerUnlinked.body":
		"{provider} can no longer sign in to your {brand} account.",
	"push.emailReclaimed.title": "Email removed",
	"push.emailReclaimed.body":
		"Your unverified email was removed from your {brand} account because its owner verified it with {provider}.",
	"push.accessRevoked.title": "Access removed",
	"push.accessRevoked.body":
		"Access to your {brand} account was removed from {app}.",
	"push.accessRevoked.bodyOther":
		"A session, device or app lost access to your {brand} account.",
};
