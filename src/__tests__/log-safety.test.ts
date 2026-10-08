import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { logProviderEvents } from "../oidc/provider-logging.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

/** A logger whose JSON lines are kept in memory. */
function capturingLogger() {
	const lines: string[] = [];
	const sink = new Writable({
		write(chunk: Buffer, _encoding, done) {
			lines.push(chunk.toString("utf8"));
			done();
		},
	});
	return { logger: createLogger("info", sink), lines };
}

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "auto" });
});

afterAll(async () => {
	await idp?.close();
});

describe("logs never carry tokens", () => {
	it("redacts token exchange parameters", () => {
		const { logger, lines } = capturingLogger();
		logger.info(
			{ params: { subject_token: "subj-secret", actor_token: "act-secret" } },
			"token request",
		);
		expect(lines.join("")).not.toMatch(/subj-secret|act-secret/);
		expect(lines.join("")).toContain("[redacted]");
	});

	it("logs a failed back-channel logout with the client and status only", async () => {
		const { logger, lines } = capturingLogger();
		logProviderEvents(idp.provider, logger);
		const client = await idp.provider.Client.find("localman-web");
		const error = Object.assign(
			new Error("expected 200 OK from https://localman/x, got: 404"),
			{ response: { status: 404 } },
		);
		idp.provider.emit("backchannel.error", {}, error, client, "acc_x", "sid");
		const entry = lines
			.map((line) => JSON.parse(line) as Record<string, unknown>)
			.find((line) => line.msg === "Back-channel logout not delivered");
		expect(entry).toMatchObject({
			clientId: "localman-web",
			error: "HTTP 404",
		});
		expect(JSON.stringify(entry)).not.toContain("sid");
	});
});
