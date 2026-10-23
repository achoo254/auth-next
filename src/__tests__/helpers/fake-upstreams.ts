/**
 * TEST ONLY. Fakes Google, GitHub and the Telegram Bot API by wrapping fetch;
 * the authorization code carries the profile (fake-upstream-codes.ts).
 */
import { z } from "zod";
import {
	type FakeProfile,
	decodeFakeCode,
	fakeAuthorizeRedirect,
	pkceMatches,
	unsignedJwt,
} from "./fake-upstream-codes.js";

export type { FakeProfile };
export { fakeAuthorizeRedirect };

export const FAKE_GOOGLE_CLIENT_ID = "test-google-client";
export const FAKE_TELEGRAM_API = "https://telegram.test";
export const FAKE_TELEGRAM_TOKEN = "123456:test-telegram-token-abcdefghij";
export const FAKE_TELEGRAM_SECRET = "test-webhook-secret-0123456789abcdef";

export interface SentTelegramMessage {
	readonly chatId: string;
	readonly text: string;
	readonly buttonUrl?: string;
	/** Payload of an inline button that calls back to the bot. */
	readonly callbackData?: string;
}

/** Environment that enables Google and GitHub (the only sign-in) against the fakes. */
export const FAKE_OAUTH_ENV: Readonly<Record<string, string>> = {
	GOOGLE_CLIENT_ID: FAKE_GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET: "test-google-secret",
	GITHUB_CLIENT_ID: "test-github-client",
	GITHUB_CLIENT_SECRET: "test-github-secret",
};

/** Environment that enables Google, GitHub and Telegram against the fakes. */
export const FAKE_UPSTREAM_ENV: Readonly<Record<string, string>> = {
	...FAKE_OAUTH_ENV,
	TELEGRAM_BOT_TOKEN: FAKE_TELEGRAM_TOKEN,
	TELEGRAM_BOT_USERNAME: "hoandat_test_bot",
	TELEGRAM_WEBHOOK_SECRET: FAKE_TELEGRAM_SECRET,
	TELEGRAM_API_BASE_URL: FAKE_TELEGRAM_API,
};

const telegramSend = z.object({
	chat_id: z.union([z.string(), z.number()]),
	text: z.string(),
	reply_markup: z
		.object({
			inline_keyboard: z.array(
				z.array(
					z.object({
						url: z.string().optional(),
						callback_data: z.string().optional(),
					}),
				),
			),
		})
		.optional(),
});

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

export class FakeUpstreams {
	readonly telegramMessages: SentTelegramMessage[] = [];
	/** Profiles returned, in order, by the fake authorize endpoints. */
	readonly nextLogins: FakeProfile[] = [];
	readonly authorizeRequests: URL[] = []; // every fake authorize request
	private readonly realFetch = globalThis.fetch;

	install(): () => void {
		const real = this.realFetch;
		globalThis.fetch = (input, init) =>
			this.handle(new Request(input, init), real);
		return () => {
			globalThis.fetch = real;
		};
	}

	private async handle(
		request: Request,
		real: typeof fetch,
	): Promise<Response> {
		const url = new URL(request.url);
		const route = `${request.method} ${url.origin}${url.pathname}`;
		if (
			route === "GET https://accounts.google.com/o/oauth2/v2/auth" ||
			route === "GET https://github.com/login/oauth/authorize"
		) {
			this.authorizeRequests.push(url);
			const profile = this.nextLogins.shift();
			if (!profile) return new Response("no queued login", { status: 500 });
			return new Response(null, {
				status: 302,
				headers: { location: fakeAuthorizeRedirect(url.href, profile) },
			});
		}
		if (route === "POST https://oauth2.googleapis.com/token") {
			const form = new URLSearchParams(await request.text());
			const profile = decodeFakeCode(form.get("code") ?? "");
			if (!pkceMatches(profile, form))
				return json({ error: "invalid_grant" }, 400);
			const now = Math.floor(Date.now() / 1000);
			const idToken = unsignedJwt({
				iss: "https://accounts.google.com",
				aud: FAKE_GOOGLE_CLIENT_ID,
				sub: profile.id,
				email: profile.email,
				email_verified: profile.emailVerified,
				name: profile.name,
				nonce: profile.nonce,
				auth_time: profile.authTime ?? now,
				iat: now,
				exp: now + 3600,
			});
			return json({
				access_token: "google-at",
				token_type: "Bearer",
				expires_in: 3600,
				id_token: idToken,
			});
		}
		if (route === "POST https://github.com/login/oauth/access_token") {
			const form = new URLSearchParams(await request.text());
			const code = form.get("code") ?? "";
			if (!pkceMatches(decodeFakeCode(code), form)) {
				return json({ error: "bad_verification_code" });
			}
			return json({
				access_token: `gh.${code}`,
				token_type: "bearer",
				scope: "read:user,user:email",
			});
		}
		if (url.origin === "https://api.github.com") {
			const token = (request.headers.get("authorization") ?? "").replace(
				/^Bearer gh\./,
				"",
			);
			const profile = decodeFakeCode(token);
			if (url.pathname === "/user") {
				return json({
					id: Number(profile.id),
					login: profile.name ?? "octocat",
					name: profile.name ?? null,
					avatar_url: null,
				});
			}
			return json([
				{
					email: profile.email,
					primary: true,
					verified: profile.emailVerified,
				},
			]);
		}
		if (
			url.origin === FAKE_TELEGRAM_API &&
			url.pathname === `/bot${FAKE_TELEGRAM_TOKEN}/answerCallbackQuery`
		) {
			return json({ ok: true, result: true });
		}
		if (url.origin === FAKE_TELEGRAM_API) {
			const message = telegramSend.safeParse(await request.json());
			if (
				url.pathname !== `/bot${FAKE_TELEGRAM_TOKEN}/sendMessage` ||
				!message.success
			) {
				return json({ ok: false, description: "Unauthorized" }, 401);
			}
			this.telegramMessages.push({
				chatId: String(message.data.chat_id),
				text: message.data.text,
				buttonUrl: message.data.reply_markup?.inline_keyboard[0]?.[0]?.url,
				callbackData:
					message.data.reply_markup?.inline_keyboard[0]?.[0]?.callback_data,
			});
			return json({ ok: true, result: {} });
		}
		return real(request);
	}
}

let shared: FakeUpstreams | undefined;

/** This process's fakes, installed once: browser and IdP must reach the same one. */
export function sharedFakeUpstreams(): FakeUpstreams {
	if (!shared) {
		shared = new FakeUpstreams();
		shared.install();
	}
	return shared;
}
