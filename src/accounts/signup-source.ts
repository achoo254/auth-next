import type { UnknownObject } from "oidc-provider";
import type { SignupSource } from "./user-model.js";

/**
 * Optional marketing tags an app may add to the authorization request that
 * starts a sign-up (`utm_source`, `utm_medium`, `utm_campaign`), and to
 * `/account?signup=1`. Recorded once, on the new account, next to the
 * client that opened the flow, so the growth numbers can say where new
 * accounts come from. A bad value never refuses a request, it is simply
 * not recorded; a tag repeated on the authorization request itself is
 * `invalid_request` like any repeated parameter, so `/account?signup=1`
 * passes on only the first value and apps must send each tag once.
 */
export const SIGNUP_UTM_PARAMS = [
	"utm_source",
	"utm_medium",
	"utm_campaign",
] as const;
type SignupUtmParam = (typeof SIGNUP_UTM_PARAMS)[number];

const TAG_MAX_LENGTH = 64;
const CLIENT_MAX_LENGTH = 128;

/** `extraParams` entries: oidc-provider keeps the tags on the interaction, whatever their value (sent once). */
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
		// A link may repeat a tag (`?utm_source=a&utm_source=b`): keep the first,
		// since oidc-provider refuses a repeated parameter.
		const value = source?.[param];
		const tag = sanitizeSourceTag(Array.isArray(value) ? value[0] : value);
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
