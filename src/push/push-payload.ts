import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import type { UpstreamProvider } from "../accounts/user-model.js";
import type { MessageKey } from "../i18n/dictionaries.js";
import type { Locale } from "../i18n/locales.js";
import { type Brand, translator } from "../i18n/translator.js";

/** Security events pushed to the account's phones. */
export const PUSH_KINDS = [
	"new-sign-in",
	"provider-linked",
	"provider-unlinked",
	"email-reclaimed",
	"access-revoked",
] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

/**
 * What a notice may say about its event. Lock screens show it, so there is
 * no field for an email, IP, code, link or token: a provider, and the name
 * of a first-party app (never a self-registered client's name).
 */
export type PushEvent =
	| { readonly kind: "new-sign-in" }
	| {
			readonly kind:
				| "provider-linked"
				| "provider-unlinked"
				| "email-reclaimed";
			readonly provider: UpstreamProvider;
	  }
	| { readonly kind: "access-revoked"; readonly appName?: string };

const TITLES: Readonly<Record<PushKind, MessageKey>> = {
	"new-sign-in": "push.newSignIn.title",
	"provider-linked": "push.providerLinked.title",
	"provider-unlinked": "push.providerUnlinked.title",
	"email-reclaimed": "push.emailReclaimed.title",
	"access-revoked": "push.accessRevoked.title",
};

function bodyOf(event: PushEvent): {
	key: MessageKey;
	params: Record<string, string>;
} {
	switch (event.kind) {
		case "new-sign-in":
			return { key: "push.newSignIn.body", params: {} };
		case "provider-linked":
			return {
				key: "push.providerLinked.body",
				params: { provider: UPSTREAM_LABELS[event.provider] },
			};
		case "provider-unlinked":
			return {
				key: "push.providerUnlinked.body",
				params: { provider: UPSTREAM_LABELS[event.provider] },
			};
		case "email-reclaimed":
			return {
				key: "push.emailReclaimed.body",
				params: { provider: UPSTREAM_LABELS[event.provider] },
			};
		case "access-revoked":
			return event.appName
				? { key: "push.accessRevoked.body", params: { app: event.appName } }
				: { key: "push.accessRevoked.bodyOther", params: {} };
	}
}

/** The APNs JSON of one notice, in the phone's language. */
export function pushPayload(
	event: PushEvent,
	locale: Locale,
	brand: Brand,
	at: Date = new Date(),
): object {
	const i18n = translator(locale, brand);
	const body = bodyOf(event);
	return {
		aps: {
			alert: {
				title: i18n.t(TITLES[event.kind]),
				body: i18n.t(body.key, body.params),
			},
			sound: "default",
			"thread-id": "account-security",
		},
		// The app opens the matching screen from these.
		kind: event.kind,
		at: at.toISOString(),
	};
}
