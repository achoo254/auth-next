/** The public guide to running the apps on your own domain, at /guide/domain. */
export const enGuide = {
	"guide.title": "Use your own domain",
	"guide.subtitle":
		"Run sign-in, Chat, Localman and Tunelo on a domain you own, with their own accounts.",
	"guide.intro":
		"Once set up, your users sign in at auth.<domain> and use Chat at chat.<domain>, Localman at localman.<domain> and Tunelo at tunnel.<domain>. Nothing to install: everything runs on {brandDomain}'s servers. Accounts, sessions, projects and tunnels of your domain never mix with another domain's.",
	"guide.figure": "Figure {number}.",
	"guide.prepare.title": "Before you start",
	"guide.prepare.account":
		"An account at auth.{brandDomain} with Google or GitHub linked. That Google or GitHub identity becomes the owner of the domain.",
	"guide.prepare.dns":
		"Access to your domain's DNS. A subdomain of a domain you own (dev.example.com) works too.",
	"guide.prepare.oauth":
		"A Google Cloud or GitHub account, to create the sign-in app of your domain (step 5).",
	"guide.prepare.cloudflare":
		"Recommended: DNS on Cloudflare, with an API token (step 6). Without it, mocks and tunnels on subdomains cannot get a certificate.",
	"guide.claim.title": "1. Start the claim",
	"guide.claim.body":
		"Open {claim}, type your domain and choose the owner identity. The claim lives 24 hours.",
	"guide.claim.figure": "Start claim: the domain and its owner.",
	"guide.dns.title": "2. Add the DNS records",
	"guide.dns.body":
		"The page lists one TXT record and six A records. Click a name or value to select it, then copy it to your DNS provider.",
	"guide.dns.figure": "The records to add, with your values.",
	"guide.dns.dnsOnly":
		"DNS only (recommended): the A records point straight at the server. Everything works, including Chat's real-time connection and every subdomain.",
	"guide.dns.proxied":
		"Proxied through Cloudflare (orange cloud) also works, with the zone's SSL mode on Full (strict). The server has a real certificate for these hosts.",
	"guide.dns.flexible":
		"Avoid Flexible: Cloudflare then cuts Chat's real-time connection, so chats never sync. If the zone must stay on Flexible, add a Configuration Rule that sets SSL to Full (strict) for chat.<domain>.",
	"guide.dns.wildcard":
		"*.localman. and *.tunnel. are two-level wildcards: Cloudflare's free plan has no edge certificate for them. Keep them DNS only unless you pay for one.",
	"guide.dns.keepTxt":
		"Keep the TXT record after the claim: the server checks it every 6 hours, and a domain that fails 3 checks in a row is suspended until DNS is right again.",
	"guide.verify.title": "3. Check DNS",
	"guide.verify.body":
		"Wait a few minutes for DNS to spread, then press Check DNS. Records that do not point at the server yet are marked; fix them and check again.",
	"guide.verify.wrongFigure":
		"One record not right yet: chat.<domain> is marked.",
	"guide.verify.done":
		"When every record is right the domain is yours and its certificates are issued within minutes. It appears under Your domains.",
	"guide.verify.doneFigure": "The claimed domain, ready for its admin page.",
	"guide.admin.title": "4. Open the admin page",
	"guide.admin.body":
		"Press Open admin. The link works once, within 2 minutes, and opens a 30-minute admin session at auth.<domain>/admin; when it ends, open it again from {claim}.",
	"guide.admin.deadline":
		"Add a sign-in method within 48 hours: a domain with none after that is removed and can be claimed again.",
	"guide.admin.figure":
		"The admin page: status, addresses and certificate first.",
	"guide.signin.title": "5. Add Google or GitHub sign-in",
	"guide.signin.body":
		"Your users sign in with a Google or GitHub app that belongs to your domain. One is enough; add both if you like.",
	"guide.signin.github":
		"GitHub: Settings, Developer settings, OAuth Apps, New OAuth App. Homepage URL https://auth.<domain>, redirect URI https://auth.<domain>/oauth/github/callback. Then generate a client secret.",
	"guide.signin.googleBranding":
		"Google: in Google Cloud, open Google Auth Platform, Branding. Fill the home page https://auth.<domain>, the privacy policy https://auth.<domain>/privacy (the page exists already) and add your domain as an authorized domain.",
	"guide.signin.googleBrandingFigure":
		"Google Auth Platform, Branding: home page, privacy policy and authorized domain.",
	"guide.signin.googleClient":
		"Then Clients, Create client: type Web application, authorized redirect URI https://auth.<domain>/oauth/google/callback.",
	"guide.signin.googleClientFigure":
		"Create OAuth client ID: Web application and its redirect URI.",
	"guide.signin.paste":
		"Paste the client ID and client secret into the admin page and save. The domain is active as soon as one provider is saved. Secrets are never shown again, and the last provider cannot be removed.",
	"guide.signin.pasteFigure":
		"The admin page shows the exact callback URL to register.",
	"guide.token.title": "6. Cloudflare token (DNS on Cloudflare)",
	"guide.token.body":
		"Mocks (<secret>.localman.<domain>) and tunnels (<name>.tunnel.<domain>) need a wildcard certificate, proved through DNS. At dash.cloudflare.com: My Profile, API Tokens, Create Token, template Edit zone DNS, zone of your domain. Paste it into the admin page; it is checked by creating and deleting a TXT record, then sealed for the certificate service.",
	"guide.token.figure": "Where the Cloudflare token goes.",
	"guide.token.without":
		"Without a token the main pages still work; mocks and tunnels on subdomains do not.",
	"guide.users.title": "7. Your users",
	"guide.users.accounts":
		"Accounts: https://auth.<domain>. They are separate from {brandDomain} accounts, even for the same person.",
	"guide.users.chat": "Chat: https://chat.<domain>.",
	"guide.users.localman":
		"Localman: https://localman.<domain>; mocks at https://<secret>.localman.<domain>; MCP at https://localman.<domain>/mcp.",
	"guide.users.tunelo":
		"Tunelo: CLI 1.8.0 or later (npm install -g tunelo@latest), then tunelo login --server https://tunnel.<domain>.",
	"guide.self.title": "Running the domain on your own server",
	"guide.self.body":
		"When {claim} offers it, choose On your own servers in step 1. You only add the TXT record; the hosts point at your server, not here. Once the domain is verified, download the setup bundle (valid for 24 hours) and follow {installGuide}. Your server then completes the setup with {brand} once, and nothing goes through {brandDomain} afterwards.",
	"guide.self.server":
		"A Linux server with Docker Compose, a public IPv4, ports 80 and 443 and Tunelo's TCP ports open, and about 4 GB of free memory.",
	"guide.self.cloudflare":
		"DNS on Cloudflare with an API token that edits the zone: the wildcard certificates of *.localman. and *.tunnel. are proven through DNS.",
	"guide.self.apps":
		"Your own Google or GitHub sign-in app, and a Cloudflare Turnstile widget for localman.<domain>.",
	"guide.self.duty":
		"{brand} does not back up, update, patch or watch your server: that is up to you. Keep the TXT record so nobody else can claim the domain here.",
	"guide.self.move":
		"Moving a domain that already runs here: in Your domains, press Move to your own servers. The domain stops being served here at once, its data kept; Cancel the move serves it again. Install the bundle without pointing the A records at your server yet, and send the operator your install's migration public key. The operator exports the domain's accounts, projects, variables, tunnel keys and messages for your server only; import them there, then point the A records at it. Tokens already issued keep working; people sign in to Localman and Chat again once.",
	"guide.self.installGuide": "the install guide",
	"guide.keep.title": "Keeping or removing the domain",
	"guide.keep.body":
		"The domain stays yours while the TXT record stays and the records point at the server. To remove it, delete the TXT record or ask the operator: its certificates, token and all its data are deleted, and the domain can be claimed again.",
	"guide.dns.cloudflareRecordFigure":
		"Cloudflare, DNS, Add record: an A record left DNS only (grey cloud).",
	"guide.dns.sslModeFigure":
		"Cloudflare, SSL/TLS: for proxied hosts pick Full (Strict) and save, not Flexible.",
	"guide.signin.githubFigure":
		"GitHub, Register a new OAuth app: homepage and redirect URI.",
	"guide.token.templateFigure":
		"Cloudflare, API Tokens, Create Token: use the Edit zone DNS template.",
	"guide.token.createFigure":
		"Zone DNS Edit, limited to your domain under Zone Resources.",
	"claim.guideLink": "Step-by-step guide with screenshots",
};
