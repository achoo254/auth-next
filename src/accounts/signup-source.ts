import type { UnknownObject } from "oidc-provider";
import type { SignupSource } from "./user-model.js";

/**
 * Optional marketing tags an app may add to the authorization request that
 * starts a sign-up (`utm_source`, `utm_medium`, `utm_campaign`), and to
 * `/account?signup=1`. Recorded once, on the new account, next to the
 * client that opened the flow, so the growth numbers can say where new
 * accounts come from. Never a reason to refuse a request: a bad value is
 * simply not recorded.
 */
export const SIGNUP_UTM_PARAMS = [
	"utm_source",
	"utm_medium",
	"utm_campaign",
] as const;
type SignupUtmParam = (typeof SIGNUP_UTM_PARAMS)[number];

const TAG_MAX_LENGTH = 64;
const CLIENT_MAX_LENGTH = 128;

/** `extraParams` entries: oidc-provider keeps the tags on the interaction, whatever their value. */
export const SIGNUP_SOURCE_EXTRA_PARAMS: Record<SignupUtmParam, () => void> = {
	utm_source: () => undefined,
	utm_medium: () => undefined,
	utm_campaign: () => undefined,
};

/**
 * A tag as recorded: lowercase, runs of characters outside `[a-z0-9_-]`
 * become one `_` (so "FB Ads" is "fb_ads"), no `_` at either end, at most
 * 64 characters. Anything else (missing, repeated, empty) is null.
 */
export function sanitizeSourceTag(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const tag = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, TAG_MAX_LENGTH)
		.replace(/_+$/, "");
	return tag.length > 0 ? tag : null;
}

/** The tags of a query or of the interaction's parameters, valid ones only. */
export function signupUtmTags(
	source: UnknownObject | undefined,
): Partial<Record<SignupUtmParam, string>> {
	const tags: Partial<Record<SignupUtmParam, string>> = {};
	for (const param of SIGNUP_UTM_PARAMS) {
		const tag = sanitizeSourceTag(source?.[param]);
		if (tag) tags[param] = tag;
	}
	return tags;
}

/**
 * Where a new account came from, read from the parameters of the
 * authorization request it was made in: the client (validated by
 * oidc-provider before any interaction exists) and the tags it passed on.
 * Undefined when the interaction has no client (it always has one).
 */
export function signupSourceOf(
	params: UnknownObject | undefined,
): SignupSource | undefined {
	const client = params?.client_id;
	if (typeof client !== "string" || client.length === 0) return undefined;
	const tags = signupUtmTags(params);
	return {
		client: client.slice(0, CLIENT_MAX_LENGTH),
		...(tags.utm_source ? { utmSource: tags.utm_source } : {}),
		...(tags.utm_medium ? { utmMedium: tags.utm_medium } : {}),
		...(tags.utm_campaign ? { utmCampaign: tags.utm_campaign } : {}),
	};
}
