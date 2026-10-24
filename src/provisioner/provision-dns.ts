import { credentialsPath } from "./certbot-commands.js";
import { openSealed, parseSealed } from "./open-sealed.js";
import type { ProvisionerDependencies } from "./provision.js";
import type { WorkItem } from "./provisioner-work.js";

/** What a Cloudflare API token looks like; anything else never reaches the ini file. */
const CLOUDFLARE_TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

/**
 * Opens the owner's DNS token sealed for this provisioner and writes it to
 * the tenant's ini file (mode 600, root only), where certbot reads it;
 * never to argv or a log. "none" when the tenant has no token, "failed"
 * when it does not open (sealed for another tenant, corrupt) or does not
 * look like a token.
 */
export async function prepareDnsChallenge(
	deps: ProvisionerDependencies,
	item: WorkItem,
	domain: string,
): Promise<"none" | "ready" | "failed"> {
	if (item.dnsCredential === null || item.dnsCredential === undefined) {
		return "none";
	}
	const sealed = parseSealed(item.dnsCredential);
	let token: string | undefined;
	try {
		token = sealed && openSealed(sealed, deps.privateKeyPem, item.tenantId);
	} catch {
		token = undefined;
	}
	if (!token || !CLOUDFLARE_TOKEN.test(token)) return "failed";
	await deps.files.writeSecret(
		credentialsPath(deps.config, domain),
		`dns_cloudflare_api_token = ${token}\n`,
	);
	return "ready";
}
