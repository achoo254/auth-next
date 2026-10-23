import { constants, type ClientHttp2Session, connect } from "node:http2";
import { SignJWT } from "jose";
import type { ApnsConfig } from "../config/ios-env.js";
import type { Logger } from "../logger.js";
import {
	type ApnsAnswer,
	BAD_TOKEN_REASONS,
	type PushResult,
	type PushSender,
	type PushTarget,
	STALE_PROVIDER_TOKEN,
	parseAnswer,
} from "./apns-response.js";
import { type ApnsEnvironment, tokenHint } from "./push-devices.js";

export type { PushResult, PushSender, PushTarget };

/** Apple's hosts, by the environment of the app build that made the token. */
export const APNS_ORIGINS: Readonly<Record<ApnsEnvironment, string>> = {
	production: "https://api.push.apple.com",
	sandbox: "https://api.sandbox.push.apple.com",
};

/**
 * Apple accepts a provider token for an hour and refuses new ones more
 * often than every 20 minutes; 50 minutes stays inside both.
 */
const PROVIDER_TOKEN_SECONDS = 50 * 60;
const REQUEST_TIMEOUT_MS = 10_000;
/** An unused connection is closed after this long. */
const IDLE_MS = 5 * 60_000;
/** A notice older than this is not worth showing any more. */
const NOTICE_TTL_SECONDS = 24 * 60 * 60;

/**
 * APNs over HTTP/2 with token-based (.p8) authentication. One connection
 * per environment, opened on first use and again after Apple sends GOAWAY
 * or the connection fails. Logs status codes and Apple's reason only:
 * never the device token in full, the provider token or the payload.
 */
export class ApnsClient implements PushSender {
	private readonly sessions = new Map<ApnsEnvironment, ClientHttp2Session>();
	private providerToken?: { readonly value: string; readonly iat: number };

	constructor(
		private readonly config: ApnsConfig,
		private readonly logger: Logger,
		private readonly origins: Readonly<
			Record<ApnsEnvironment, string>
		> = APNS_ORIGINS,
	) {}

	async send(target: PushTarget, payload: object): Promise<PushResult> {
		try {
			const answer = await this.post(target, payload);
			return this.interpret(target, answer);
		} catch (error) {
			this.logger.warn(
				{
					reason: error instanceof Error ? error.message : "unknown",
					device: tokenHint(target.token),
				},
				"APNs request failed",
			);
			return { status: "failed" };
		}
	}

	close(): void {
		for (const session of this.sessions.values()) session.close();
		this.sessions.clear();
	}

	private interpret(target: PushTarget, answer: ApnsAnswer): PushResult {
		if (answer.status === 200) return { status: "sent" };
		this.logger.warn(
			{
				status: answer.status,
				reason: answer.reason,
				device: tokenHint(target.token),
			},
			"APNs refused the notice",
		);
		if (answer.status === 410) {
			return answer.timestamp
				? { status: "unregistered", at: new Date(answer.timestamp) }
				: { status: "unregistered" };
		}
		if (answer.reason && BAD_TOKEN_REASONS.has(answer.reason)) {
			return { status: "bad-token" };
		}
		if (answer.reason && STALE_PROVIDER_TOKEN.has(answer.reason)) {
			this.providerToken = undefined;
		}
		return { status: "failed" };
	}

	private async bearer(): Promise<string> {
		const now = Math.floor(Date.now() / 1000);
		const cached = this.providerToken;
		if (cached && now - cached.iat < PROVIDER_TOKEN_SECONDS) {
			return cached.value;
		}
		const value = await new SignJWT({})
			.setProtectedHeader({ alg: "ES256", kid: this.config.keyId })
			.setIssuer(this.config.teamId)
			.setIssuedAt(now)
			.sign(this.config.privateKey);
		this.providerToken = { value, iat: now };
		return value;
	}

	private session(environment: ApnsEnvironment): ClientHttp2Session {
		const open = this.sessions.get(environment);
		if (open && !open.closed && !open.destroyed) return open;
		const session = connect(this.origins[environment]);
		const forget = (): void => {
			if (this.sessions.get(environment) === session) {
				this.sessions.delete(environment);
			}
		};
		// GOAWAY: finish what is in flight, new requests use a new connection.
		session.on("goaway", () => {
			forget();
			session.close();
		});
		session.on("close", forget);
		session.on("error", (error: Error) => {
			forget();
			this.logger.warn({ reason: error.message }, "APNs connection failed");
		});
		session.setTimeout(IDLE_MS, () => session.close());
		// Never keeps the process alive on its own.
		session.unref();
		this.sessions.set(environment, session);
		return session;
	}

	private async post(target: PushTarget, payload: object): Promise<ApnsAnswer> {
		const authorization = `bearer ${await this.bearer()}`;
		const session = this.session(target.environment);
		return new Promise((resolve, reject) => {
			const request = session.request({
				[constants.HTTP2_HEADER_METHOD]: "POST",
				[constants.HTTP2_HEADER_PATH]: `/3/device/${target.token}`,
				authorization,
				"apns-topic": this.config.topic,
				"apns-push-type": "alert",
				"apns-priority": "10",
				"apns-expiration": String(
					Math.floor(Date.now() / 1000) + NOTICE_TTL_SECONDS,
				),
				"content-type": "application/json",
			});
			let status = 0;
			let body = "";
			request.setEncoding("utf8");
			request.setTimeout(REQUEST_TIMEOUT_MS, () => {
				request.close(constants.NGHTTP2_CANCEL);
				reject(new Error("timeout"));
			});
			request.on("response", (headers) => {
				status = Number(headers[constants.HTTP2_HEADER_STATUS] ?? 0);
			});
			request.on("data", (chunk: string) => {
				if (body.length < 4096) body += chunk;
			});
			request.on("end", () => resolve(parseAnswer(status, body)));
			request.on("error", reject);
			request.end(JSON.stringify(payload));
		});
	}
}
