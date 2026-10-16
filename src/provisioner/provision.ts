import {
	type Command,
	certificateNames,
	credentialsPath,
	deleteCommand,
	issueHostsCommand,
	issueWildcardCommand,
	readableByNginxCommands,
} from "./certbot-commands.js";
import { configuredServerNames, conflictingName } from "./nginx-names.js";

/** What a Cloudflare API token looks like; anything else never reaches the ini file. */
const CLOUDFLARE_TOKEN = /^[A-Za-z0-9_-]{20,200}$/;
import { openSealed, parseSealed } from "./open-sealed.js";
import { type ProvisionerConfig, checkedDomain } from "./provisioner-config.js";
import { type Outcome, type WorkItem, parseWork } from "./provisioner-work.js";

/** Runs a program without a shell; output is never logged or reported. */
export type CommandRunner = (
	command: Command,
) => Promise<{ readonly code: number; readonly output: string }>;

/** File operations on root-only paths. */
export interface ProvisionerFiles {
	writeSecret(path: string, content: string): Promise<void>;
	remove(path: string): Promise<void>;
}

export interface ProvisionerDependencies {
	readonly config: ProvisionerConfig;
	/** The nginx configuration with its includes (nginx-config.ts). */
	readonly nginxConfig: () => Promise<string>;
	readonly privateKeyPem: string;
	readonly run: CommandRunner;
	readonly files: ProvisionerFiles;
	readonly fetch: typeof fetch;
	readonly log: (message: string, fields?: Record<string, unknown>) => void;
}

function authorization(config: ProvisionerConfig): string {
	const credentials = `provisioner:${config.PROVISIONER_INTERNAL_SECRET}`;
	return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

async function removeTenant(
	deps: ProvisionerDependencies,
	domain: string,
): Promise<Outcome> {
	const names = certificateNames(domain);
	for (const name of [names.hosts, names.wildcard]) {
		const result = await deps.run(deleteCommand(deps.config, name));
		// A certificate never issued (no token, failed issuance) is fine.
		if (result.code !== 0 && !/No certificate found/i.test(result.output)) {
			return { outcome: "failed", error: "certbot delete failed" };
		}
	}
	await deps.files.remove(credentialsPath(deps.config, domain));
	return { outcome: "removed" };
}

/** Runs commands in order; false at the first failure. */
async function runAll(
	deps: ProvisionerDependencies,
	commands: readonly Command[],
): Promise<boolean> {
	for (const command of commands) {
		if ((await deps.run(command)).code !== 0) return false;
	}
	return true;
}

async function issueTenant(
	deps: ProvisionerDependencies,
	item: WorkItem,
	domain: string,
	configured: readonly string[],
): Promise<Outcome> {
	const conflict = conflictingName(domain, configured);
	if (conflict)
		return { outcome: "failed", error: `server name in use: ${conflict}` };
	const names = certificateNames(domain);
	const dns = item.dnsCredential !== null && item.dnsCredential !== undefined;
	if (dns) {
		const sealed = parseSealed(item.dnsCredential ?? "");
		let token: string | undefined;
		try {
			token = sealed && openSealed(sealed, deps.privateKeyPem, item.tenantId);
		} catch {
			token = undefined;
		}
		if (!token || !CLOUDFLARE_TOKEN.test(token)) {
			return { outcome: "failed", error: "dns token does not open" };
		}
		const path = credentialsPath(deps.config, domain);
		await deps.files.writeSecret(path, `dns_cloudflare_api_token = ${token}\n`);
	}
	// With a token the hosts certificate is DNS-01 too, so proxied hosts
	// (any Cloudflare SSL mode) get one; without, HTTP-01.
	if (
		(await deps.run(issueHostsCommand(deps.config, domain, dns))).code !== 0
	) {
		return {
			outcome: "failed",
			error: dns ? "dns-01 issuance failed" : "http-01 issuance failed",
		};
	}
	if (
		!(await runAll(deps, readableByNginxCommands(deps.config, names.hosts)))
	) {
		return { outcome: "failed", error: "certificate permissions failed" };
	}
	if (!dns) return { outcome: "issued" };
	if ((await deps.run(issueWildcardCommand(deps.config, domain))).code !== 0) {
		return { outcome: "failed", error: "dns-01 issuance failed" };
	}
	if (
		!(await runAll(deps, readableByNginxCommands(deps.config, names.wildcard)))
	) {
		return { outcome: "failed", error: "certificate permissions failed" };
	}
	return { outcome: "issued" };
}

/**
 * One pass of the provisioner: reads due work from the IdP's internal API,
 * checks each domain itself (and against every name nginx already serves),
 * issues or removes the tenant's certificates, makes them readable to the
 * nginx workers and reports each outcome. It never reloads nginx: the
 * tenants' server blocks load certificates by name at handshake. Renewal
 * is certbot's own timer for the tenants' config directory.
 */
export async function provisionOnce(
	deps: ProvisionerDependencies,
): Promise<{ readonly handled: number; readonly failed: number }> {
	const base = deps.config.PROVISIONER_INTERNAL_URL.replace(/\/+$/, "");
	const headers = { authorization: authorization(deps.config) };
	const response = await deps.fetch(`${base}/internal/certificates/work`, {
		headers,
		redirect: "error",
	});
	if (!response.ok)
		throw new Error(`work queue answered HTTP ${response.status}`);
	const work = parseWork(await response.json());
	if (work.length === 0) return { handled: 0, failed: 0 };
	const configured = configuredServerNames(await deps.nginxConfig());
	let failed = 0;
	for (const item of work) {
		// One tenant's failure (or a lost report) never stops the others.
		let outcome: Outcome;
		try {
			const domain = checkedDomain(item.domain, deps.config);
			outcome = !domain
				? { outcome: "failed", error: "domain refused by the provisioner" }
				: item.action === "remove"
					? await removeTenant(deps, domain)
					: await issueTenant(deps, item, domain, configured);
		} catch {
			outcome = { outcome: "failed", error: "provisioner error" };
		}
		if (outcome.outcome === "failed") failed += 1;
		const reported = await deps
			.fetch(`${base}/internal/certificates/${item.tenantId}`, {
				method: "POST",
				headers: { ...headers, "content-type": "application/json" },
				body: JSON.stringify(outcome),
				redirect: "error",
			})
			.then((answer) => answer.ok)
			.catch(() => false);
		if (!reported) failed += 1;
		deps.log("Tenant certificate work", {
			tenantId: item.tenantId,
			action: item.action,
			outcome: outcome.outcome,
			reported,
		});
	}
	return { handled: work.length, failed };
}
