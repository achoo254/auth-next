/** Claiming a domain (/claim on the primary tenant) and a tenant's /admin. */
export const enTenants = {
	"claim.title": "Use your own domain",
	"claim.lead":
		"Run {brand} sign-in, Chat, Localman and Tunelo on a domain you control: auth., chat., localman. and tunnel. under it, with their own accounts.",
	"claim.unavailable": "Claiming domains is not open on this server.",
	"claim.noIdentity":
		"Link a Google or GitHub account to your account first: the domain's owner is that account.",
	"claim.form.domain": "Domain",
	"claim.form.domainHelp": "For example example.com or dev.example.com.",
	"claim.hosting.label": "Where it runs",
	"claim.hosting.hoandat": "On {brand}'s servers",
	"claim.hosting.hoandatHelp":
		"Nothing to install. Data lives on {brand}'s servers, kept apart per domain.",
	"claim.hosting.self": "On your own servers",
	"claim.hosting.selfHelp":
		"{brand} only verifies the domain and issues the setup bundle. After that every request and all data stay on your servers; backups, updates and security are yours.",
	"claim.form.owner": "Owner",
	"claim.form.ownerOption": "{provider} account {name}",
	"claim.form.submit": "Start claim",
	"claim.pending.title": "Waiting for DNS: {domain}",
	"claim.pending.lead":
		"Add these records at your DNS provider, then check. DNS only is the simplest and works for everything. Proxied through Cloudflare also works with the zone's SSL mode on Full (strict); Flexible breaks Chat's real-time connection.",
	"claim.pending.leadSelf":
		"Add this TXT record at your DNS provider, then check. The domain's hosts point at your own servers, not here.",
	"claim.records.hint":
		"Click a name or value to select all of it, then copy it into your DNS provider.",
	"claim.records.type": "Type",
	"claim.records.name": "Name",
	"claim.records.content": "Content",
	"claim.records.proxy": "Proxy",
	"claim.records.wrong": "Not yet",
	"claim.records.proxyChoice": "DNS only (recommended)",
	"claim.pending.expires": "The claim expires {date}.",
	"claim.pending.verify": "Check DNS",
	"claim.tenants.title": "Your domains",
	"claim.tenants.claimed": "Claimed: add a sign-in provider",
	"claim.tenants.active": "Active",
	"claim.tenants.suspended": "Suspended",
	"claim.tenants.enrolling":
		"Verified: waiting for the install on your servers",
	"claim.tenants.selfHosted": "Runs on your own servers",
	"claim.tenants.bundle": "Download setup bundle",
	"claim.tenants.admin": "Open admin",
	"claim.notice.started": "Claim started. Add the DNS records below.",
	"claim.notice.verified":
		"Domain claimed. Open admin to add Google or GitHub sign-in.",
	"claim.notice.verifiedSelf":
		"Domain verified. Next, set it up on your own servers.",
	"claim.error.invalidDomain": "That is not a domain that can be claimed here.",
	"claim.error.taken":
		"This domain, or one above or below it, is already in use.",
	"claim.error.tooManyPending":
		"You already have claims waiting. Finish one or let it expire first.",
	"claim.error.tooManyTenants":
		"You already hold the most domains one account can have here.",
	"claim.error.capacity":
		"This server cannot take another domain right now. Try again later.",
	"claim.error.notFound": "This claim has expired or is not yours.",
	"claim.error.dnsTxt":
		"The TXT record is missing or has another value. DNS changes can take a few minutes.",
	"claim.error.dnsAddress":
		"The records marked “Not yet” do not point to {ip} (DNS only) or to Cloudflare's proxy. Fix them and check again; DNS changes can take a few minutes.",
	"claim.error.dnsUnreachable":
		"DNS could not be checked right now. Try again in a minute.",
	"admin.title": "Admin",
	"admin.lead": "Settings of {domain}. Only its owner can open this page.",
	"admin.signedOut":
		"Open this page from {link}, signed in with the account that claimed the domain.",
	"admin.status.claimed":
		"Not active yet: add Google or GitHub below. Until then nobody can sign in here.",
	"admin.status.active": "Active: people sign in at {issuer}.",
	"admin.hosts.title": "Addresses",
	"admin.hosts.help":
		"Their A records can be DNS only (recommended) or proxied by Cloudflare. Proxied needs SSL Full (strict): Flexible breaks Chat's real-time connection. Proxied *.localman. and *.tunnel. subdomains also need a Cloudflare edge certificate that covers two-level wildcards (paid plans).",
	"admin.certificate.pending": "Certificates: being issued.",
	"admin.certificate.issued": "Certificates: issued {date}.",
	"admin.certificate.failed":
		"Certificates: the last attempt failed ({error}); next try {date}.",
	"admin.name.title": "Display name",
	"admin.name.help": "Shown on every sign-in and account page.",
	"admin.oauth.title": "Sign in with {provider}",
	"admin.oauth.help":
		"Create an OAuth app at {provider} with this callback URL: {callback}",
	"admin.oauth.googlePrivacy":
		"Google also asks for a privacy policy URL: {url}",
	"admin.oauth.clientId": "Client ID",
	"admin.oauth.clientSecret": "Client secret",
	"admin.oauth.configured": "Configured, client ID {clientId}.",
	"admin.oauth.remove": "Remove",
	"admin.dns.title": "Cloudflare DNS token",
	"admin.dns.help":
		"Needed only when the DNS of {domain} is on Cloudflare: the wildcard certificate (*.localman., *.tunnel.) is issued through DNS. Create the token at dash.cloudflare.com → My Profile → API Tokens → Create Token → template “Edit zone DNS”, with the zone of {domain} under Zone Resources (an account API token with the same permission works too). It is sealed for the certificate service; nobody can read it back.",
	"admin.dns.token": "API token",
	"admin.dns.configured": "A token is saved.",
	"admin.dns.unavailable": "DNS tokens cannot be saved on this server yet.",
	"admin.telegram.title": "Telegram bot (optional)",
	"admin.telegram.help":
		"Lets people link a chat for security notices. Create the bot with @BotFather.",
	"admin.telegram.token": "Bot token",
	"admin.telegram.username": "Bot username",
	"admin.telegram.configured": "Connected to @{username}.",
	"admin.save": "Save",
	"admin.signOut": "Leave admin",
	"admin.result.saved": "Saved.",
	"admin.result.invalid": "Check the values and try again.",
	"admin.result.lastProvider":
		"Keep at least one sign-in provider: without one nobody can sign in.",
	"admin.result.cloudflareInvalid": "Cloudflare refused this token.",
	"admin.result.cloudflareNoZone":
		"This token cannot see the zone of {domain}.",
	"admin.result.cloudflareNoDnsEdit":
		"This token cannot edit DNS records of {domain}.",
	"admin.result.cloudflareUnreachable":
		"Cloudflare could not be reached. Try again.",
	"admin.result.dnsUnavailable":
		"DNS tokens cannot be saved on this server yet.",
	"admin.result.telegramRefused": "Telegram refused this bot token.",
	"inactive.title": "Not set up yet",
	"inactive.body": "Sign-in at {host} is not set up yet.",
};
