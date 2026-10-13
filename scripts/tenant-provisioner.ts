/**
 * Issues and removes tenants' certificates (ADR 0006), as root, from a
 * systemd timer:
 *
 *   node dist/tenant-provisioner.mjs run          one pass of the queue
 *   node dist/tenant-provisioner.mjs keygen <dir> RSA key pair: key.pem (600)
 *                                                 and key.pub.pem for the IdP
 *
 * Settings come from its own env file (see infra/provisioner/README.md).
 * Programs run without a shell; DNS tokens only ever reach a root-only
 * credentials file, never argv or the log.
 */
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type CommandRunner,
	provisionOnce,
} from "../src/provisioner/provision.js";
import { parseProvisionerConfig } from "../src/provisioner/provisioner-config.js";

const run: CommandRunner = (command) =>
	new Promise((resolve) => {
		execFile(
			command.file,
			[...command.args],
			{
				shell: false,
				maxBuffer: 16 * 1024 * 1024,
				env: { PATH: "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" },
			},
			(error, stdout, stderr) => {
				const code = error
					? typeof error.code === "number"
						? error.code
						: 1
					: 0;
				resolve({ code, output: `${stdout}\n${stderr}` });
			},
		);
	});

function log(message: string, fields: Record<string, unknown> = {}): void {
	process.stdout.write(
		`${JSON.stringify({ time: new Date().toISOString(), msg: message, ...fields })}\n`,
	);
}

async function keygen(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const { publicKey, privateKey } = generateKeyPairSync("rsa", {
		modulusLength: 3072,
	});
	await writeFile(
		join(dir, "key.pem"),
		privateKey.export({ type: "pkcs8", format: "pem" }),
		{ mode: 0o600, flag: "wx" },
	);
	await writeFile(
		join(dir, "key.pub.pem"),
		publicKey.export({ type: "spki", format: "pem" }),
		{ mode: 0o644, flag: "wx" },
	);
	log("Provisioner key pair written", { dir });
}

async function runOnce(): Promise<number> {
	const config = parseProvisionerConfig(process.env);
	const result = await provisionOnce({
		config,
		privateKeyPem: await readFile(config.PROVISIONER_PRIVATE_KEY_PATH, "utf8"),
		run,
		fetch,
		log,
		files: {
			async writeSecret(path, content) {
				await mkdir(dirname(path), { recursive: true, mode: 0o700 });
				await writeFile(path, content, { mode: 0o600 });
				await chmod(path, 0o600);
			},
			remove: (path) => rm(path, { force: true }),
		},
	});
	log("Provisioner pass done", result);
	return result.failed === 0 ? 0 : 1;
}

const [command, argument] = process.argv.slice(2);
const task =
	command === "run"
		? runOnce()
		: command === "keygen" && argument
			? keygen(argument).then(() => 0)
			: Promise.reject(
					new Error("usage: tenant-provisioner run | keygen <dir>"),
				);
task.then(
	(code) => process.exit(code),
	(error: unknown) => {
		log("Provisioner failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		process.exit(1);
	},
);
