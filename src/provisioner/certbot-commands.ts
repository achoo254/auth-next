import { join } from "node:path";
import { appHostsFor } from "../tenants/tenant.js";
import type { ProvisionerConfig } from "./provisioner-config.js";

/** A program and its arguments, run without a shell. */
export interface Command {
	readonly file: string;
	readonly args: readonly string[];
}

/** Names of a tenant's two certificates (nginx maps hosts to them). */
export function certificateNames(domain: string): {
	readonly hosts: string;
	readonly wildcard: string;
} {
	return { hosts: domain, wildcard: `wildcard.${domain}` };
}

/** Where the Cloudflare credentials of a tenant live (mode 600, root only). */
export function credentialsPath(
	config: ProvisionerConfig,
	domain: string,
): string {
	return join(config.PROVISIONER_CONFIG_DIR, "credentials", `${domain}.ini`);
}

function common(config: ProvisionerConfig): string[] {
	return [
		"--config-dir",
		config.PROVISIONER_CONFIG_DIR,
		"--work-dir",
		join(config.PROVISIONER_CONFIG_DIR, "work"),
		"--logs-dir",
		join(config.PROVISIONER_CONFIG_DIR, "logs"),
		"--non-interactive",
		...(config.PROVISIONER_ACME === "staging" ? ["--test-cert"] : []),
	];
}

/**
 * HTTP-01 certificate for auth., localman. and tunnel. of the domain,
 * answered from the shared webroot by the tenants' port-80 server block.
 * `--keep-until-expiring` makes a second run a no-op.
 */
export function issueHostsCommand(
	config: ProvisionerConfig,
	domain: string,
): Command {
	const hosts = appHostsFor(domain);
	return {
		file: config.PROVISIONER_CERTBOT,
		args: [
			"certonly",
			...common(config),
			"--agree-tos",
			"--register-unsafely-without-email",
			"--keep-until-expiring",
			"--webroot",
			"--webroot-path",
			config.PROVISIONER_WEBROOT,
			"--cert-name",
			certificateNames(domain).hosts,
			"-d",
			hosts.auth,
			"-d",
			hosts.localman,
			"-d",
			hosts.tunnel,
		],
	};
}

/**
 * DNS-01 certificate for *.localman. and *.tunnel. with the owner's
 * Cloudflare token, read by certbot from the credentials file (never argv).
 * Renewals reuse the same file.
 */
export function issueWildcardCommand(
	config: ProvisionerConfig,
	domain: string,
): Command {
	const hosts = appHostsFor(domain);
	return {
		file: config.PROVISIONER_CERTBOT,
		args: [
			"certonly",
			...common(config),
			"--agree-tos",
			"--register-unsafely-without-email",
			"--keep-until-expiring",
			"--dns-cloudflare",
			"--dns-cloudflare-credentials",
			credentialsPath(config, domain),
			"--dns-cloudflare-propagation-seconds",
			"30",
			"--cert-name",
			certificateNames(domain).wildcard,
			"-d",
			hosts.localmanWildcard,
			"-d",
			hosts.tunnelWildcard,
		],
	};
}

export function deleteCommand(
	config: ProvisionerConfig,
	certName: string,
): Command {
	return {
		file: config.PROVISIONER_CERTBOT,
		args: ["delete", ...common(config), "--cert-name", certName],
	};
}

/** `nginx -T`: the full configuration, to check names before issuing. */
export function nginxDumpCommand(config: ProvisionerConfig): Command {
	return { file: config.PROVISIONER_NGINX, args: ["-T"] };
}
