/**
 * AI providers whose keys a tenant owner gives Scribe (ADR 0012). Codes
 * match Scribe's `Vendor::code`; the order is the one /admin lists them in.
 */
export const SCRIBE_VENDORS = [
	"elevenlabs",
	"openai",
	"gemini",
	"anthropic",
] as const;

export type ScribeVendor = (typeof SCRIBE_VENDORS)[number];

/** Providers that transcribe: a tenant runs Scribe once it has one of them. */
export const SCRIBE_TRANSCRIPTION_VENDORS: readonly ScribeVendor[] = [
	"elevenlabs",
	"openai",
	"gemini",
];

/** The `tenant_secrets` kind of a provider's key, sealed for Scribe. */
export type ScribeKeyKind = `scribe-${ScribeVendor}`;

/** What Scribe reports about a key it could not use. */
export const SCRIBE_KEY_STATUSES = ["invalid", "quota", "unreadable"] as const;

export type ScribeKeyStatus = (typeof SCRIBE_KEY_STATUSES)[number];

export const SCRIBE_VENDOR_LABELS: Readonly<Record<ScribeVendor, string>> = {
	elevenlabs: "ElevenLabs",
	openai: "OpenAI",
	gemini: "Google Gemini",
	anthropic: "Anthropic Claude",
};

export function isScribeVendor(value: unknown): value is ScribeVendor {
	return SCRIBE_VENDORS.some((vendor) => vendor === value);
}

export function isScribeKeyStatus(value: unknown): value is ScribeKeyStatus {
	return SCRIBE_KEY_STATUSES.some((status) => status === value);
}

export function scribeKeyKind(vendor: ScribeVendor): ScribeKeyKind {
	return `scribe-${vendor}`;
}
