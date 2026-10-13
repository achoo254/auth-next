import { type IncomingHttpHeaders, type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { AuditDispatcher } from "../../audit/audit-dispatcher.js";
import { createSecurityEventSigner } from "../../audit/security-event-token.js";
import { createLogger } from "../../logger.js";
import type { TestIdp } from "./test-idp.js";

export const AUDIT_CLIENT_ID = "hoandat-auth";
/** Characters that URL-encoding would change: the header must be plain base64. */
export const AUDIT_CLIENT_SECRET = "audit+secret/for=tests-0123456789abcdef";

export interface ReceivedEvent {
	readonly headers: IncomingHttpHeaders;
	readonly body: string;
}

/**
 * Stand-in for Localman's POST /internal/audit-events: records requests and
 * answers with `status` (or never answers while `hang` is set).
 */
export class AuditReceiver {
	readonly received: ReceivedEvent[] = [];
	status = 202;
	hang = false;
	private readonly server: Server;
	private port = 0;

	constructor() {
		this.server = createServer((req, res) => {
			const chunks: Buffer[] = [];
			req.on("data", (chunk: Buffer) => chunks.push(chunk));
			req.on("end", () => {
				this.received.push({
					headers: req.headers,
					body: Buffer.concat(chunks).toString("utf8"),
				});
				if (this.hang) return;
				res.statusCode = this.status;
				res.end();
			});
		});
	}

	get url(): string {
		return `http://127.0.0.1:${this.port}/internal/audit-events`;
	}

	async start(): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			this.server.once("error", reject);
			this.server.listen(0, "127.0.0.1", () => resolve());
		});
		this.port = (this.server.address() as AddressInfo).port;
	}

	async close(): Promise<void> {
		this.server.closeAllConnections();
		await new Promise<void>((resolve) => this.server.close(() => resolve()));
	}
}

/** A URL nothing listens on (the port of a server that was just closed). */
export async function deadUrl(): Promise<string> {
	const receiver = new AuditReceiver();
	await receiver.start();
	const url = receiver.url;
	await receiver.close();
	return url;
}

/** A dispatcher for `idp`'s outbox, polling fast, posting to `url`. */
export function testDispatcher(
	idp: TestIdp,
	url: string,
	options: { readonly timeoutMs?: number; readonly now?: () => Date } = {},
): AuditDispatcher {
	return new AuditDispatcher({
		outbox: idp.services.audit,
		deliveryFor: async () => ({
			config: {
				url,
				clientId: AUDIT_CLIENT_ID,
				clientSecret: AUDIT_CLIENT_SECRET,
			},
			sign: createSecurityEventSigner({
				issuer: idp.issuer,
				audience: url,
				jwks: idp.jwks,
			}),
		}),
		logger: createLogger("silent"),
		requestTimeoutMs: options.timeoutMs ?? 2_000,
		pollIntervalMs: 20,
		now: options.now,
	});
}

/** Records a sign-in event for a fixed test subject; returns its id. */
export async function recordTestLogin(idp: TestIdp): Promise<string> {
	const id = await idp.services.audit.record(
		"login.succeeded",
		"acc_audit",
		{ methods: ["pwd"] },
		{ ip: "203.0.113.7", userAgent: "vitest" },
	);
	if (!id) throw new Error("audit event not recorded");
	return id;
}
