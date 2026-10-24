import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import {
	probeScribeKey,
	scribeKeyFormatOk,
	scribeKeyVerdict,
} from "./scribe-key-probes.js";
import type { ScribeVendor } from "./scribe-vendors.js";

interface Call {
	readonly url: string;
	readonly method: string;
	readonly headers: Headers;
	readonly redirect?: RequestRedirect;
}

/** A made-up key of the given prefix (never a real credential). */
function fakeKey(prefix: string): string {
	return [prefix, "probe", "0123456789abcdef"].join("-");
}

/** A provider answering `status`/`body`, recording what was asked. */
function fakeProvider(status: number, body = "{}") {
	const calls: Call[] = [];
	const fetcher: typeof fetch = async (input, init) => {
		calls.push({
			url: String(input),
			method: init?.method ?? "GET",
			headers: new Headers(init?.headers),
			redirect: init?.redirect,
		});
		return new Response(body, { status });
	};
	return { fetcher, calls };
}

describe("probeScribeKey", () => {
	const cases: readonly [ScribeVendor, string, string, string, string][] = [
		[
			"elevenlabs",
			"POST",
			"https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
			"xi-api-key",
			"KEY",
		],
		[
			"openai",
			"GET",
			"https://api.openai.com/v1/models",
			"authorization",
			"Bearer KEY",
		],
		[
			"gemini",
			"GET",
			"https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
			"x-goog-api-key",
			"KEY",
		],
		[
			"anthropic",
			"GET",
			"https://api.anthropic.com/v1/models?limit=1",
			"x-api-key",
			"KEY",
		],
	];

	it.each(cases)(
		"asks %s with the key in a header only",
		async (vendor, method, url, header, value) => {
			const { fetcher, calls } = fakeProvider(200);
			const key = fakeKey("sk");
			expect(await probeScribeKey(fetcher, vendor, key)).toBe("valid");
			expect(calls).toHaveLength(1);
			const [call] = calls;
			expect(call?.method).toBe(method);
			expect(call?.url).toBe(url);
			expect(call?.url).not.toContain(key);
			expect(call?.headers.get(header)).toBe(value.replace("KEY", key));
			expect(call?.redirect).toBe("error");
		},
	);

	it("sends Anthropic's API version", async () => {
		const { fetcher, calls } = fakeProvider(200);
		await probeScribeKey(fetcher, "anthropic", fakeKey("sk-ant"));
		expect(calls[0]?.headers.get("anthropic-version")).toBe("2023-06-01");
	});

	it("is unreachable when the call fails, never throwing", async () => {
		const failing: typeof fetch = async () => {
			throw new TypeError("fetch failed");
		};
		expect(await probeScribeKey(failing, "openai", fakeKey("sk"))).toBe(
			"unreachable",
		);
	});
});

describe("scribeKeyVerdict", () => {
	it("maps answers the way Scribe does", () => {
		const quota = '{"error":{"code":"insufficient_quota"}}';
		expect(scribeKeyVerdict("openai", 200, "{}")).toBe("valid");
		expect(scribeKeyVerdict("openai", 401, "{}")).toBe("invalid");
		expect(scribeKeyVerdict("openai", 429, quota)).toBe("no-credit");
		expect(scribeKeyVerdict("elevenlabs", 402, "{}")).toBe("no-credit");
		expect(
			scribeKeyVerdict(
				"elevenlabs",
				401,
				'{"detail":{"status":"quota_exceeded"}}',
			),
		).toBe("no-credit");
		expect(scribeKeyVerdict("anthropic", 403, "{}")).toBe("invalid");
		expect(
			scribeKeyVerdict(
				"gemini",
				400,
				'{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}',
			),
		).toBe("invalid");
		expect(scribeKeyVerdict("gemini", 400, "{}")).toBe("unreachable");
		const daily =
			'{"error":{"details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}';
		expect(scribeKeyVerdict("gemini", 429, daily)).toBe("no-credit");
		expect(scribeKeyVerdict("gemini", 429, "{}")).toBe("unreachable");
		expect(scribeKeyVerdict("anthropic", 500, "{}")).toBe("unreachable");
	});
});

describe("scribeKeyFormatOk", () => {
	it("accepts one run of 20 to 300 visible characters", () => {
		expect(scribeKeyFormatOk("openai", fakeKey("sk"))).toBe(true);
		expect(scribeKeyFormatOk("openai", fakeKey("test"))).toBe(false);
		expect(scribeKeyFormatOk("openai", fakeKey("sk-ant"))).toBe(false);
		expect(scribeKeyFormatOk("anthropic", fakeKey("sk-ant"))).toBe(true);
		expect(scribeKeyFormatOk("gemini", "short")).toBe(false);
		expect(scribeKeyFormatOk("elevenlabs", `${fakeKey("sk")} x`)).toBe(false);
		expect(scribeKeyFormatOk("elevenlabs", "a".repeat(301))).toBe(false);
	});
});

describe("logs", () => {
	it("redact the apiKey form field", () => {
		const lines: string[] = [];
		const sink = new Writable({
			write(chunk: Buffer, _encoding, done) {
				lines.push(chunk.toString("utf8"));
				done();
			},
		});
		const value = fakeKey("sk");
		createLogger("info", sink).info({ body: { apiKey: value } }, "form");
		expect(lines.join("")).not.toContain(value);
		expect(lines.join("")).toContain("[redacted]");
	});
});
