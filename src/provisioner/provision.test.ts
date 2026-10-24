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
const TOKEN = "cfTokenMustNeverReachArgv0123456789abcd";

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
	reportFailure = false,
) {
	const commands: Command[] = [];
	const reports: { tenantId: string; kind?: string; body: unknown }[] = [];
	const secrets = new Map<string, string>();
	const removed: string[] = [];
	const deps: ProvisionerDependencies = {
		config,
		privateKeyPem: PRIVATE_PEM,
		log: () => undefined,
		files: {
			writeSecret: async (path, content) => {
				// credentialsPath uses path.join; the expectations are POSIX paths.
				secrets.set(path.replaceAll("\\", "/"), content);
			},
			remove: async (path) => {
				removed.push(path.replaceAll("\\", "/"));
			},
		},
		nginxConfig: async () => NGINX_DUMP,
		run: async (command) => {
			commands.push(command);
			const failure = failing(command);
			return failure ? { code: 1, output: failure } : { code: 0, output: "" };
		},
		fetch: async (input, init) => {
			const url = String(input);
			expect(new Headers(init?.headers).get("authorization")).toMatch(
				/^Basic /,
			);
			if (url.endsWith("/internal/certificates/work?kinds=hosts,scribe"))
				return Response.json({ work });
			const reportUrl = new URL(url);
			const kind = reportUrl.searchParams.get("kind");
			reports.push({
				tenantId: reportUrl.pathname.split("/").pop() ?? "",
				...(kind ? { kind } : {}),
				body: JSON.parse(String(init?.body)),
			});
			if (reportFailure) throw new Error("IdP restarting");
			return new Response(null, { status: 204 });
		},
	};
	return { deps, commands, reports, secrets, removed };
}

const sealed = (tenantId: string) =>
	sealForProvisioner(TOKEN, `${tenantId}\ndns-cloudflare`, PUBLIC_PEM);

describe("provisioner", () => {
	it("issues DNS-01 certificates with the owner's token, the token only in a credentials file", async () => {
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
		// DNS-01 for the hosts too, so they may be proxied in any SSL mode.
		expect(certbot[0]?.args).not.toContain("--webroot");
		expect(certbot[0]?.args).toEqual(
			expect.arrayContaining([
				"--dns-cloudflare",
				"-d",
				"auth.acme.org",
				"chat.acme.org",
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

	it("issues only the hosts certificate over HTTP-01 without a token", async () => {
		const run = harness([
			{
				tenantId: "ten_a",
				domain: "acme.org",
				action: "issue",
				dnsCredential: null,
			},
		]);
		expect(await provisionOnce(run.deps)).toEqual({ handled: 1, failed: 0 });
		const certbot = run.commands.filter(
			(command) => command.args[0] === "certonly",
		);
		expect(certbot).toHaveLength(1);
		expect(certbot[0]?.args).not.toContain("--dns-cloudflare");
		expect(certbot[0]?.args).toEqual(
			expect.arrayContaining([
				"--webroot",
				"auth.acme.org",
				"chat.acme.org",
				"localman.acme.org",
				"tunnel.acme.org",
			]),
		);
		expect(run.secrets.size).toBe(0);
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
		"localman.acme.org",
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

	it("removes every certificate and the credentials, tolerating one never issued", async () => {
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
				command.args.includes("wildcard.old.org") ||
				command.args.includes("scribe.old.org")
					? "No certificate found with that name"
					: undefined,
		);
		await provisionOnce(run.deps);
		expect(
			run.commands
				.filter((command) => command.args[0] === "delete")
				.map((command) => command.args.at(-1)),
		).toEqual(["old.org", "wildcard.old.org", "scribe.old.org"]);
		expect(run.removed).toEqual([
			"/etc/letsencrypt-tenants/credentials/old.org.ini",
		]);
		expect(run.reports[0]?.body).toEqual({ outcome: "removed" });
	});

	it("refuses a token that does not look like one, and a corrupt credential", async () => {
		const odd = harness([
			{
				tenantId: "ten_h",
				domain: "odd.org",
				action: "issue",
				dnsCredential: sealForProvisioner(
					"bad\nkey = x",
					"ten_h\ndns-cloudflare",
					PUBLIC_PEM,
				),
			},
		]);
		await provisionOnce(odd.deps);
		expect(odd.reports[0]?.body).toEqual({
			outcome: "failed",
			error: "dns token does not open",
		});
		expect(odd.secrets.size).toBe(0);
		const corrupt = harness([
			{
				tenantId: "ten_i",
				domain: "corrupt.org",
				action: "issue",
				dnsCredential: { kid: 1 },
			},
		]);
		await provisionOnce(corrupt.deps);
		expect(corrupt.reports[0]?.body).toEqual({
			outcome: "failed",
			error: "dns token does not open",
		});
	});

	it("keeps going when a report is lost, and counts it as a failure", async () => {
		const run = harness(
			[
				{
					tenantId: "ten_j",
					domain: "one.org",
					action: "issue",
					dnsCredential: null,
				},
				{
					tenantId: "ten_k",
					domain: "two.org",
					action: "issue",
					dnsCredential: null,
				},
			],
			() => undefined,
			true,
		);
		expect(await provisionOnce(run.deps)).toEqual({ handled: 2, failed: 2 });
		expect(run.reports.map((report) => report.tenantId)).toEqual([
			"ten_j",
			"ten_k",
		]);
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

describe("provisioner, scribe.<domain> (ADR 0012)", () => {
	const certNames = (commands: Command[]) =>
		commands
			.filter((command) => command.args[0] === "certonly")
			.map((command) => command.args[command.args.indexOf("--cert-name") + 1]);

	it("issues scribe.<domain> alone over HTTP-01 and reports it as scribe work", async () => {
		const run = harness([
			{
				tenantId: "ten_s",
				domain: "acme.org",
				kind: "scribe",
				action: "issue",
				dnsCredential: null,
			},
		]);
		expect(await provisionOnce(run.deps)).toEqual({ handled: 1, failed: 0 });
		expect(certNames(run.commands)).toEqual(["scribe.acme.org"]);
		const certbot = run.commands.find((c) => c.args[0] === "certonly");
		expect(certbot?.args).toEqual(
			expect.arrayContaining(["--webroot", "-d", "scribe.acme.org"]),
		);
		expect(certbot?.args).not.toContain("auth.acme.org");
		expect(run.reports).toEqual([
			{ tenantId: "ten_s", kind: "scribe", body: { outcome: "issued" } },
		]);
	});

	it("uses the owner's token for DNS-01 when there is one", async () => {
		const run = harness([
			{
				tenantId: "ten_s",
				domain: "acme.org",
				kind: "scribe",
				action: "issue",
				dnsCredential: sealed("ten_s"),
			},
		]);
		await provisionOnce(run.deps);
		const certbot = run.commands.find((c) => c.args[0] === "certonly");
		expect(certbot?.args).toEqual(
			expect.arrayContaining(["--dns-cloudflare", "-d", "scribe.acme.org"]),
		);
		expect(certbot?.args.join(" ")).not.toContain(TOKEN);
		expect(run.reports[0]?.body).toEqual({ outcome: "issued" });
	});

	it("refuses a scribe name another block serves, and reports failure as scribe work", async () => {
		const run = harness([
			{
				tenantId: "ten_s",
				domain: "inetdev.io.vn",
				kind: "scribe",
				action: "issue",
				dnsCredential: null,
			},
			{
				tenantId: "ten_t",
				domain: "taken.org",
				kind: "scribe",
				action: "issue",
				dnsCredential: null,
			},
		]);
		run.deps = {
			...run.deps,
			nginxConfig: async () =>
				`${NGINX_DUMP}\nserver { server_name scribe.taken.org; }`,
		};
		await provisionOnce(run.deps);
		expect(certNames(run.commands)).toEqual([]);
		expect(run.reports).toEqual([
			{
				tenantId: "ten_s",
				kind: "scribe",
				body: { outcome: "failed", error: "domain refused by the provisioner" },
			},
			{
				tenantId: "ten_t",
				kind: "scribe",
				body: {
					outcome: "failed",
					error: "server name in use: scribe.taken.org",
				},
			},
		]);
	});

	it("removes only the scribe certificate for scribe work", async () => {
		const run = harness([
			{
				tenantId: "ten_s",
				domain: "acme.org",
				kind: "scribe",
				action: "remove",
				dnsCredential: null,
			},
		]);
		await provisionOnce(run.deps);
		expect(
			run.commands
				.filter((command) => command.args[0] === "delete")
				.map((command) => command.args.at(-1)),
		).toEqual(["scribe.acme.org"]);
		expect(run.removed).toEqual([]);
		expect(run.reports[0]).toEqual({
			tenantId: "ten_s",
			kind: "scribe",
			body: { outcome: "removed" },
		});
	});
});
