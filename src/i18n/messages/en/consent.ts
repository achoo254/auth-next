/** Consent, scope descriptions, the device (Tunelo CLI) pages. */
export const enConsent = {
	"consent.pageTitle": "Allow access",
	"consent.titleForApp": "Allow {app} to use your {brand} account",
	"consent.titleExternal": "Allow an external app to use your {brand} account",
	"consent.redirect":
		"After you allow it, you go back to {host} with a code the app exchanges for tokens.",
	"consent.willBeAbleTo": "The app will be able to:",
	"consent.allow": "Allow",
	"consent.deny": "Deny",
	"consent.revokeHint":
		"You can remove this access any time on your account page.",
	"consent.externalNotice":
		"External app, not published by {brandDomain}. The app chose its own name and {brand} doesn't check who is behind it. Only allow it if you just connected it yourself (for example a coding agent using MCP).",
	"consent.lookalikeWarning":
		"This app's name looks like a {brandDomain} product, but it isn't one. That's only expected when you just added Localman MCP to a coding agent on your own machine (then the name contains localman and you're sent back to localhost or 127.0.0.1). Otherwise, deny.",
	"consent.credentialsWarning":
		"Lets the app create new access keys and secrets for you. Only allow apps you trust.",
	"scope.openid": "Know who you are (your {brand} account ID)",
	"scope.profile": "See your name, username and profile picture",
	"scope.email": "See your email address",
	"scope.offlineAccess":
		"Stay signed in while you're not using the app (up to 30 days)",
	"scope.telegram": "Send notices to the Telegram chat you linked",
	"scope.mockRead":
		"See the Localman mock projects you can access, with their resources, schemas and data",
	"scope.mockWrite":
		"Create, edit and delete mock projects and resources on Localman, generate or reset data",
	"scope.clientRead":
		"See workspaces, collections, requests and environments in the Localman API client you can access (secret variables stay masked)",
	"scope.clientWrite":
		"Create, edit, delete and import collections and requests, and set environment variables in the Localman API client",
	"scope.clientSend":
		"Send requests for you through the Localman proxy, including to localhost through Tunelo (counts toward your proxy quota)",
	"scope.credentialsWrite":
		"Create personal access tokens, service account secrets and access keys on Localman",
	"scope.tunnelsOpen": "Open new tunnels with your account",
	"scope.tunnelsRead": "See your list of tunnels",
	"scope.unknown": "Permission “{scope}”",
	"device.input.title": "Device sign-in",
	"device.input.subtitle":
		"Enter the code shown on your machine (for example in the tunelo terminal window).",
	"device.input.label": "Device code",
	"device.error.noCode": "Enter the code shown on your machine.",
	"device.error.notFound":
		"That code isn't right. Check the code on your machine.",
	"device.error.expired":
		"The code has expired. Run the sign-in command on your machine again for a new code.",
	"device.error.used":
		"This code was already used. Run the sign-in command on your machine again.",
	"device.error.aborted": "Denied. The other machine won't get access.",
	"device.error.other":
		"The request couldn't be processed. Try again in a few minutes.",
	"device.confirm.title": "Check the device code",
	"device.confirm.subtitle": "Request from {device}.",
	"device.confirm.help":
		"Only continue if this code matches the one shown on your machine.",
	"device.confirm.match": "Code matches, continue",
	"device.onMachine": "{app} on {machine}",
	"device.unknownName": "unknown machine",
	"device.genericLabel": "device",
	"device.success.pageTitle": "Device allowed",
	"device.success.title": "Allowed",
	"device.success.subtitle": "{device} is now signed in to your account.",
	"device.success.alert":
		"Go back to the terminal; the machine continues by itself. You can close this page.",
	"device.success.manage": "Manage devices on your account page",
	"device.approve.title": "Approve device",
	"device.approve.question": "Allow {device}?",
	"device.approve.code": "Code: {code}",
	"device.approve.ip": "requested from IP {ip}",
};
