import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sealForProvisioner } from "../tenants/secret-keyring.js";
import type { Command } from "./certbot-commands.js";
import { type ProvisionerDependencies, provisionOnce } from "./provision.js";
import { parseProvisionerConfig } from "./provisioner-config.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
});
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const PRIVATE_PEM = privateKey
	.export({ type: "pkcs8", format: "pem" })
	.toString();
const TOKEN = "cf-token-must-never-reach-argv";

const config = parseProvisionerConfig({
	PROVISIONER_INTERNAL_SECRET: "p".repeat(40),
	PROVISIONER_PRIVATE_KEY_PATH: "/unused",
	PROVISIONER_BLOCKED_DOMAINS: "hoandat.com,inetdev.io.vn",
});

const NGINX_DUMP = `
server { server_name auth.hoandat.com; }
server { server_name tunnel.inetdev.io.vn *.tunnel.inetdev.io.vn; }
server { server_name tunnel.legacy.org; }
server { server_name ~^auth\\.(?<tenant>.+)$; }
`;

function harness(
	work: unknown[],
	failing: (command: Command) => string | undefined = () => undefined,
) {
	const commands: Command[] = [];
	const reports: { tenantId: string; body: unknown }[] = [];
	const secrets = new Map<string, string>();
	const removed: string[] = [];
	const deps: ProvisionerDependencies = {
		config,
		privateKeyPem: PRIVATE_PEM,
		log: () => undefined,
		files: {
			writeSecret: async (path, content) => {
				secrets.set(path, content);
			},
			remove: async (path) => {
				removed.push(path);
			},
		},
		run: async (command) => {
			commands.push(command);
			if (command.args[0] === "-T") return { code: 0, output: NGINX_DUMP };
			const failure = failing(command);
			return failure ? { code: 1, output: failure } : { code: 0, output: "" };
		},
		fetch: async (input, init) => {
			const url = String(input);
			expect(new Headers(init?.headers).get("authorization")).toMatch(
				/^Basic /,
			);
			if (url.endsWith("/internal/certificates/work"))
				return Response.json({ work });
			reports.push({
				tenantId: url.split("/").pop() ?? "",
				body: JSON.parse(String(init?.body)),
			});
			return new Response(null, { status: 204 });
		},
	};
	return { deps, commands, reports, secrets, removed };
}

const sealed = (tenantId: string) =>
	sealForProvisioner(TOKEN, `${tenantId}\ndns-cloudflare`, PUBLIC_PEM);

describe("provisioner", () => {
	it("issues HTTP-01 and DNS-01 certificates, the token only in a credentials file", async () => {
		const run = harness([
			{
				tenantId: "ten_a",
				domain: "acme.org",
				action: "issue",
				dnsCredential: sealed("ten_a"),
			},
		]);
		expect(await provisionOnce(run.deps)).toEqual({ handled: 1, failed: 0 });
		const certbot = run.commands.filter(
			(command) => command.args[0] === "certonly",
		);
		expect(
			certbot.map(
				(command) =>
					command.args.slice(
						command.args.indexOf("--cert-name") + 1,
						command.args.indexOf("--cert-name") + 2,
					)[0],
			),
		).toEqual(["acme.org", "wildcard.acme.org"]);
		expect(certbot[0]?.args).toEqual(
			expect.arrayContaining([
				"--webroot",
				"-d",
				"auth.acme.org",
				"--test-cert",
				"--config-dir",
				"/etc/letsencrypt-tenants",
			]),
		);
		expect(certbot[1]?.args).toEqual(
			expect.arrayContaining([
				"--dns-cloudflare",
				"-d",
				"*.localman.acme.org",
				"*.tunnel.acme.org",
			]),
		);
		for (const command of run.commands)
			expect(command.args.join(" ")).not.toContain(TOKEN);
		expect([...run.secrets.values()]).toEqual([
			`dns_cloudflare_api_token = ${TOKEN}\n`,
		]);
		expect([...run.secrets.keys()]).toEqual([
			"/etc/letsencrypt-tenants/credentials/acme.org.ini",
		]);
		expect(run.reports).toEqual([
			{ tenantId: "ten_a", body: { outcome: "issued" } },
		]);
	});

	it.each([
		"evil.org;rm -rf /",
		"evil.org\nserver_name x",
		"Acme.org",
		"acme.org.",
		"x.hoandat.com",
		"../../etc",
		"*.acme.org",
		42,
	])("refuses the domain %j without running certbot", async (domain) => {
		const run = harness([
			{ tenantId: "ten_b", domain, action: "issue", dnsCredential: null },
		]);
		expect(await provisionOnce(run.deps)).toEqual({ handled: 1, failed: 1 });
		expect(run.commands.filter((command) => command.args[0] !== "-T")).toEqual(
			[],
		);
		expect(run.reports[0]?.body).toEqual({
			outcome: "failed",
			error: "domain refused by the provisioner",
		});
	});

	it("refuses a domain whose hostnames another server block serves", async () => {
		const run = harness([
			{
				tenantId: "ten_c",
				domain: "legacy.org",
				action: "issue",
				dnsCredential: null,
			},
		]);
		await provisionOnce(run.deps);
		expect(run.reports[0]?.body).toEqual({
			outcome: "failed",
			error: "server name in use: tunnel.legacy.org",
		});
		expect(run.commands.some((command) => command.args[0] === "certonly")).toBe(
			false,
		);
	});

	it("does not open a token sealed for another tenant", async () => {
		const run = harness([
			{
				tenantId: "ten_e",
				domain: "beta.org",
				action: "issue",
				dnsCredential: sealed("ten_other"),
			},
		]);
		await provisionOnce(run.deps);
		expect(run.reports[0]?.body).toEqual({
			outcome: "failed",
			error: "dns token does not open",
		});
		expect(run.secrets.size).toBe(0);
	});

	it("reports a failed issuance without certbot's output", async () => {
		const run = harness(
			[
				{
					tenantId: "ten_f",
					domain: "gamma.org",
					action: "issue",
					dnsCredential: null,
				},
			],
			(command) =>
				command.args[0] === "certonly"
					? "Detail: secret-ish output"
					: undefined,
		);
		await provisionOnce(run.deps);
		expect(run.reports[0]?.body).toEqual({
			outcome: "failed",
			error: "http-01 issuance failed",
		});
	});

	it("removes both certificates and the credentials, tolerating one never issued", async () => {
		const run = harness(
			[
				{
					tenantId: "ten_g",
					domain: "old.org",
					action: "remove",
					dnsCredential: null,
				},
			],
			(command) =>
				command.args.includes("wildcard.old.org")
					? "No certificate found with name wildcard.old.org"
					: undefined,
		);
		await provisionOnce(run.deps);
		expect(
			run.commands
				.filter((command) => command.args[0] === "delete")
				.map((command) => command.args.at(-1)),
		).toEqual(["old.org", "wildcard.old.org"]);
		expect(run.removed).toEqual([
			"/etc/letsencrypt-tenants/credentials/old.org.ini",
		]);
		expect(run.reports[0]?.body).toEqual({ outcome: "removed" });
	});

	it("defaults to Let's Encrypt staging", () => {
		expect(config.PROVISIONER_ACME).toBe("staging");
		expect(
			parseProvisionerConfig({
				PROVISIONER_INTERNAL_SECRET: "p".repeat(40),
				PROVISIONER_PRIVATE_KEY_PATH: "/k",
				PROVISIONER_ACME: "production",
			}).PROVISIONER_ACME,
		).toBe("production");
	});
});
