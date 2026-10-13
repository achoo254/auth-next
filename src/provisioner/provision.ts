import {
	type Command,
	certificateNames,
	credentialsPath,
	deleteCommand,
	issueHostsCommand,
	issueWildcardCommand,
	nginxDumpCommand,
} from "./certbot-commands.js";
import { configuredServerNames, conflictingName } from "./nginx-names.js";
import { openSealed, parseSealed } from "./open-sealed.js";
import { type ProvisionerConfig, checkedDomain } from "./provisioner-config.js";

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
	readonly privateKeyPem: string;
	readonly run: CommandRunner;
	readonly files: ProvisionerFiles;
	readonly fetch: typeof fetch;
	readonly log: (message: string, fields?: Record<string, unknown>) => void;
}

interface WorkItem {
	readonly tenantId: string;
	readonly domain: unknown;
	readonly action: "issue" | "remove";
	readonly dnsCredential: unknown;
}

type Outcome =
	| { readonly outcome: "issued" | "removed" }
	| {
			readonly outcome: "failed";
			readonly error: string;
	  };

function authorization(config: ProvisionerConfig): string {
	const credentials = `provisioner:${config.PROVISIONER_INTERNAL_SECRET}`;
	return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

function parseWork(body: unknown): WorkItem[] {
	const work =
		typeof body === "object" && body !== null
			? Reflect.get(body, "work")
			: undefined;
	if (!Array.isArray(work)) return [];
	return work.flatMap((item: unknown) => {
		if (typeof item !== "object" || item === null) return [];
		const tenantId = Reflect.get(item, "tenantId");
		const action = Reflect.get(item, "action");
		if (typeof tenantId !== "string" || !/^ten_[\w-]+$/.test(tenantId))
			return [];
		if (action !== "issue" && action !== "remove") return [];
		return [
			{
				tenantId,
				action,
				domain: Reflect.get(item, "domain"),
				dnsCredential: Reflect.get(item, "dnsCredential"),
			},
		];
	});
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

async function issueTenant(
	deps: ProvisionerDependencies,
	item: WorkItem,
	domain: string,
	configured: ReadonlySet<string>,
): Promise<Outcome> {
	const conflict = conflictingName(domain, configured);
	if (conflict)
		return { outcome: "failed", error: `server name in use: ${conflict}` };
	if ((await deps.run(issueHostsCommand(deps.config, domain))).code !== 0) {
		return { outcome: "failed", error: "http-01 issuance failed" };
	}
	const sealed = parseSealed(item.dnsCredential);
	if (sealed) {
		let token: string;
		try {
			token = openSealed(sealed, deps.privateKeyPem, item.tenantId);
		} catch {
			return { outcome: "failed", error: "dns token does not open" };
		}
		const path = credentialsPath(deps.config, domain);
		await deps.files.writeSecret(path, `dns_cloudflare_api_token = ${token}\n`);
		if (
			(await deps.run(issueWildcardCommand(deps.config, domain))).code !== 0
		) {
			return { outcome: "failed", error: "dns-01 issuance failed" };
		}
	}
	return { outcome: "issued" };
}

/**
 * One pass of the provisioner: reads due work from the IdP's internal API,
 * checks each domain itself, issues or removes the tenant's certificates
 * and reports each outcome. It never touches nginx: the tenants' server
 * blocks load certificates by name at handshake, so new files take effect
 * without a reload. Renewal is certbot's own timer for the tenants'
 * config directory, not this pass.
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
	const dump = await deps.run(nginxDumpCommand(deps.config));
	if (dump.code !== 0) throw new Error("nginx -T failed");
	const configured = configuredServerNames(dump.output);
	let failed = 0;
	for (const item of work) {
		const domain = checkedDomain(item.domain, deps.config);
		const outcome: Outcome = !domain
			? { outcome: "failed", error: "domain refused by the provisioner" }
			: item.action === "remove"
				? await removeTenant(deps, domain)
				: await issueTenant(deps, item, domain, configured);
		if (outcome.outcome === "failed") failed += 1;
		deps.log("Tenant certificate work", {
			tenantId: item.tenantId,
			action: item.action,
			outcome: outcome.outcome,
		});
		await deps.fetch(`${base}/internal/certificates/${item.tenantId}`, {
			method: "POST",
			headers: { ...headers, "content-type": "application/json" },
			body: JSON.stringify(outcome),
			redirect: "error",
		});
	}
	return { handled: work.length, failed };
}
