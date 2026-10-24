import {
	certificateNames,
	deleteCommand,
	issueScribeCommand,
	readableByNginxCommands,
} from "./certbot-commands.js";
import { conflictingName } from "./nginx-names.js";
import { prepareDnsChallenge } from "./provision-dns.js";
import type { ProvisionerDependencies } from "./provision.js";
import type { Outcome, WorkItem } from "./provisioner-work.js";

/**
 * Issues the `scribe.<d>` certificate (ADR 0012): refused when another
 * server block already serves that name; DNS-01 with the owner's token,
 * HTTP-01 without. Never touches the tenant's other certificates.
 */
export async function issueScribe(
	deps: ProvisionerDependencies,
	item: WorkItem,
	domain: string,
	configured: readonly string[],
): Promise<Outcome> {
	const conflict = conflictingName(domain, configured, "scribe");
	if (conflict) {
		return { outcome: "failed", error: `server name in use: ${conflict}` };
	}
	const dns = await prepareDnsChallenge(deps, item, domain);
	if (dns === "failed") {
		return { outcome: "failed", error: "dns token does not open" };
	}
	const issue = issueScribeCommand(deps.config, domain, dns === "ready");
	if ((await deps.run(issue)).code !== 0) {
		return {
			outcome: "failed",
			error:
				dns === "ready" ? "dns-01 issuance failed" : "http-01 issuance failed",
		};
	}
	const name = certificateNames(domain).scribe;
	for (const command of readableByNginxCommands(deps.config, name)) {
		if ((await deps.run(command)).code !== 0) {
			return { outcome: "failed", error: "certificate permissions failed" };
		}
	}
	return { outcome: "issued" };
}

/** Deletes the `scribe.<d>` lineage; one never issued is fine. */
export async function removeScribe(
	deps: ProvisionerDependencies,
	domain: string,
): Promise<Outcome> {
	const name = certificateNames(domain).scribe;
	const result = await deps.run(deleteCommand(deps.config, name));
	if (result.code !== 0 && !/No certificate found/i.test(result.output)) {
		return { outcome: "failed", error: "certbot delete failed" };
	}
	return { outcome: "removed" };
}
