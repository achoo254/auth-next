import { join } from "node:path";
import { appHostsFor } from "../tenants/tenant.js";
import type { ProvisionerConfig } from "./provisioner-config.js";

/** A program and its arguments, run without a shell. */
export interface Command {
	readonly file: string;
	readonly args: readonly string[];
}

/**
 * Names of a tenant's certificates (nginx maps hosts to them): hosts,
 * wildcard, and `scribe.<d>`, a lineage of its own (ADR 0012).
 */
export function certificateNames(domain: string): {
	readonly hosts: string;
	readonly wildcard: string;
	readonly scribe: string;
} {
	return {
		hosts: domain,
		wildcard: `wildcard.${domain}`,
		scribe: `scribe.${domain}`,
	};
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
 * Certificate for auth., chat., localman. and tunnel. of the domain.
 * With the owner's Cloudflare token (`dns`) it is a DNS-01 certificate,
 * which works whether the hosts are DNS-only or proxied by Cloudflare in
 * any SSL mode; without it, HTTP-01 answered from the shared webroot by the
 * tenants' port-80 server block (DNS-only hosts, or proxied in Flexible).
 * `--keep-until-expiring` makes a second run a no-op.
 */
export function issueHostsCommand(
	config: ProvisionerConfig,
	domain: string,
	dns = false,
): Command {
	const hosts = appHostsFor(domain);
	return issueCommand(config, domain, dns, certificateNames(domain).hosts, [
		hosts.auth,
		hosts.chat,
		hosts.localman,
		hosts.tunnel,
	]);
}

/**
 * Certificate for `scribe.<d>` alone (ADR 0012), DNS-01 with the owner's
 * token or HTTP-01 like the hosts certificate. A lineage of its own: a
 * missing `scribe.` record never breaks the other hosts' certificate.
 */
export function issueScribeCommand(
	config: ProvisionerConfig,
	domain: string,
	dns = false,
): Command {
	const name = certificateNames(domain).scribe;
	return issueCommand(config, domain, dns, name, [name]);
}

function issueCommand(
	config: ProvisionerConfig,
	domain: string,
	dns: boolean,
	certName: string,
	names: readonly string[],
): Command {
	const method = dns
		? [
				"--dns-cloudflare",
				"--dns-cloudflare-credentials",
				credentialsPath(config, domain),
				"--dns-cloudflare-propagation-seconds",
				"30",
			]
		: ["--webroot", "--webroot-path", config.PROVISIONER_WEBROOT];
	return {
		file: config.PROVISIONER_CERTBOT,
		args: [
			"certonly",
			...common(config),
			"--agree-tos",
			"--register-unsafely-without-email",
			"--keep-until-expiring",
			...method,
			"--cert-name",
			certName,
			...names.flatMap((name) => ["-d", name]),
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

/**
 * Lets nginx workers (its group) read one certificate: nginx loads tenant
 * certificates at handshake, as the worker user. certbot keeps the group
 * bits of a private key when it renews.
 */
export function readableByNginxCommands(
	config: ProvisionerConfig,
	certName: string,
): Command[] {
	const paths = ["live", "archive"].map((dir) =>
		join(config.PROVISIONER_CONFIG_DIR, dir, certName),
	);
	return [
		{
			file: "/usr/bin/chgrp",
			args: ["-R", config.PROVISIONER_NGINX_GROUP, ...paths],
		},
		{ file: "/usr/bin/chmod", args: ["-R", "g+rX,o-rwx", ...paths] },
	];
}
