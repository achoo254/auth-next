import type { ScribeVendor } from "./scribe-vendors.js";

/**
 * Checks an AI key before it is saved, with the same cheap calls Scribe
 * makes for personal keys (`user_keys/check.rs`), none of which costs
 * credit:
 * - ElevenLabs: `POST /v1/single-use-token/realtime_scribe` (a one-time
 *   token that expires unused after 15 minutes; needs Speech-to-Text only);
 * - OpenAI: `GET /v1/models`;
 * - Gemini: `GET /v1beta/models?pageSize=1`;
 * - Anthropic: `GET /v1/models?limit=1`.
 *
 * The key travels in a header only. The provider's reply (it may name the
 * account) is never logged or shown; only its verdict is kept.
 */
export type ScribeKeyVerdict =
	| "valid"
	| "invalid"
	| "no-credit"
	| "unreachable";

/** API roots of the providers (tests point them at a fake). */
export type ScribeProviderBases = Readonly<Record<ScribeVendor, string>>;

export const LIVE_PROVIDER_BASES: ScribeProviderBases = {
	elevenlabs: "https://api.elevenlabs.io",
	openai: "https://api.openai.com",
	gemini: "https://generativelanguage.googleapis.com",
	anthropic: "https://api.anthropic.com",
};

const ANTHROPIC_VERSION = "2023-06-01";
const PROBE_TIMEOUT_MS = 10_000;

/**
 * The shape Scribe accepts: one run of 20–300 visible ASCII characters;
 * an OpenAI key starts with `sk-` and is not an Anthropic `sk-ant-` key.
 */
export function scribeKeyFormatOk(vendor: ScribeVendor, key: string): boolean {
	if (key.length < 20 || key.length > 300 || !/^[\x21-\x7e]+$/.test(key)) {
		return false;
	}
	if (vendor === "openai") {
		return key.startsWith("sk-") && !key.startsWith("sk-ant-");
	}
	return true;
}

function probeRequest(
	vendor: ScribeVendor,
	key: string,
	bases: ScribeProviderBases,
): { url: string; init: RequestInit } {
	const base = bases[vendor];
	switch (vendor) {
		case "elevenlabs":
			return {
				url: `${base}/v1/single-use-token/realtime_scribe`,
				init: { method: "POST", headers: { "xi-api-key": key } },
			};
		case "openai":
			return {
				url: `${base}/v1/models`,
				init: { headers: { authorization: `Bearer ${key}` } },
			};
		case "gemini":
			return {
				url: `${base}/v1beta/models?pageSize=1`,
				init: { headers: { "x-goog-api-key": key } },
			};
		case "anthropic":
			return {
				url: `${base}/v1/models?limit=1`,
				init: {
					headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
				},
			};
	}
}

/** Gemini's 429 for a spent daily free quota or a spend limit, not a burst. */
function geminiQuotaExhausted(lower: string): boolean {
	const daily = lower.includes("quotafailure") && lower.includes("perday");
	const spend = lower.includes("spend") && lower.includes("limit");
	return daily || spend;
}

/** Maps the provider's answer to a verdict, as Scribe does. */
export function scribeKeyVerdict(
	vendor: ScribeVendor,
	status: number,
	body: string,
): ScribeKeyVerdict {
	if (status >= 200 && status < 300) return "valid";
	const lower = body.toLowerCase();
	const quota =
		lower.includes("quota_exceeded") ||
		lower.includes("insufficient_credits") ||
		lower.includes("insufficient_quota");
	if (status === 402) return "no-credit";
	const openaiOrElevenlabs = vendor === "openai" || vendor === "elevenlabs";
	if (openaiOrElevenlabs && (status === 401 || status === 429) && quota) {
		return "no-credit";
	}
	if (status === 401 || status === 403) return "invalid";
	if (vendor === "gemini" && status === 429 && geminiQuotaExhausted(lower)) {
		return "no-credit";
	}
	const geminiInvalid =
		lower.includes("api_key_invalid") || lower.includes("api key not valid");
	if (vendor === "gemini" && status === 400 && geminiInvalid) return "invalid";
	return "unreachable";
}

/** Asks the provider whether `key` works; never throws. */
export async function probeScribeKey(
	fetcher: typeof fetch,
	vendor: ScribeVendor,
	key: string,
	bases: ScribeProviderBases = LIVE_PROVIDER_BASES,
): Promise<ScribeKeyVerdict> {
	const { url, init } = probeRequest(vendor, key, bases);
	try {
		const response = await fetcher(url, {
			...init,
			redirect: "error",
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		const body = await response.text().catch(() => "");
		return scribeKeyVerdict(vendor, response.status, body);
	} catch {
		return "unreachable";
	}
}
