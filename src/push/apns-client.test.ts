import { generateKeyPairSync } from "node:crypto";
import {
	type Http2Server,
	type IncomingHttpHeaders,
	type ServerHttp2Stream,
	createServer,
} from "node:http2";
import type { AddressInfo } from "node:net";
import { decodeProtectedHeader, jwtVerify } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { ApnsClient } from "./apns-client.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
	namedCurve: "prime256v1",
});
const CONFIG = {
	keyId: "KEY1234567",
	teamId: "TEAM123456",
	topic: "com.example.account",
	privateKey,
};
const TOKEN = "a1".repeat(32);

interface Received {
	readonly headers: IncomingHttpHeaders;
	readonly body: string;
}

type Reply = (stream: ServerHttp2Stream) => void;

let server: Http2Server;
let origin: string;
const received: Received[] = [];
let replies: Reply[] = [];
let sessionsOpened = 0;

function reply(status: number, body?: object): Reply {
	return (stream) => {
		stream.respond({ ":status": status, "content-type": "application/json" });
		stream.end(body ? JSON.stringify(body) : undefined);
	};
}

beforeAll(async () => {
	// h2c: the client is told the origin; TLS is not what is tested.
	server = createServer();
	server.on("session", () => {
		sessionsOpened += 1;
	});
	server.on("stream", (stream, headers) => {
		let body = "";
		stream.setEncoding("utf8");
		stream.on("data", (chunk: string) => {
			body += chunk;
		});
		stream.on("end", () => {
			received.push({ headers, body });
			(replies.shift() ?? reply(200))(stream);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
	received.length = 0;
	replies = [];
});

function capture(): { lines: string[]; client: ApnsClient } {
	const lines: string[] = [];
	const logger = createLogger("info", {
		write: (line: string) => {
			lines.push(line);
		},
	});
	return {
		lines,
		client: new ApnsClient(CONFIG, logger, {
			production: origin,
			sandbox: origin,
		}),
	};
}

describe("ApnsClient", () => {
	it("posts an alert to /3/device/<token> with a valid ES256 provider token", async () => {
		const { client } = capture();
		const result = await client.send(
			{ token: TOKEN, environment: "sandbox" },
			{ aps: { alert: { title: "t", body: "b" } } },
		);
		expect(result).toEqual({ status: "sent" });
		const [request] = received;
		expect(request?.headers[":method"]).toBe("POST");
		expect(request?.headers[":path"]).toBe(`/3/device/${TOKEN}`);
		expect(request?.headers["apns-topic"]).toBe(CONFIG.topic);
		expect(request?.headers["apns-push-type"]).toBe("alert");
		expect(JSON.parse(request?.body ?? "")).toEqual({
			aps: { alert: { title: "t", body: "b" } },
		});
		const jwt = String(request?.headers.authorization).replace(/^bearer /, "");
		expect(decodeProtectedHeader(jwt)).toEqual({
			alg: "ES256",
			kid: CONFIG.keyId,
		});
		const { payload } = await jwtVerify(jwt, publicKey, {
			issuer: CONFIG.teamId,
		});
		expect(typeof payload.iat).toBe("number");
		// The provider token is reused, not signed again for each notice.
		await client.send({ token: TOKEN, environment: "sandbox" }, {});
		expect(received[1]?.headers.authorization).toBe(
			request?.headers.authorization,
		);
		client.close();
	});

	it("reports 410 with Apple's time, bad tokens and server errors without logging the token", async () => {
		const { client, lines } = capture();
		const target = { token: TOKEN, environment: "production" } as const;
		replies = [
			reply(410, { reason: "Unregistered", timestamp: 1_700_000_000_000 }),
			reply(400, { reason: "BadDeviceToken" }),
			reply(500, { reason: "InternalServerError" }),
			reply(403, { reason: "ExpiredProviderToken" }),
		];
		expect(await client.send(target, {})).toEqual({
			status: "unregistered",
			at: new Date(1_700_000_000_000),
		});
		expect(await client.send(target, {})).toEqual({ status: "bad-token" });
		expect(await client.send(target, {})).toEqual({ status: "failed" });
		expect(await client.send(target, {})).toEqual({ status: "failed" });
		const logged = lines.join("\n");
		expect(logged).toContain("BadDeviceToken");
		expect(logged).toContain("410");
		expect(logged).not.toContain(TOKEN);
		expect(logged).not.toMatch(/eyJ[\w-]+\./);
		client.close();
	});

	it("opens a new connection after GOAWAY", async () => {
		const { client } = capture();
		const target = { token: TOKEN, environment: "sandbox" } as const;
		replies = [
			(stream) => {
				reply(200)(stream);
				stream.session?.goaway();
			},
		];
		const opened = sessionsOpened;
		expect(await client.send(target, {})).toEqual({ status: "sent" });
		// Let the client see the GOAWAY frame.
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(await client.send(target, {})).toEqual({ status: "sent" });
		expect(sessionsOpened - opened).toBe(2);
		client.close();
	});

	it("never throws when APNs cannot be reached", async () => {
		const logger = createLogger("silent");
		const client = new ApnsClient(CONFIG, logger, {
			production: "http://127.0.0.1:9",
			sandbox: "http://127.0.0.1:9",
		});
		expect(
			await client.send({ token: TOKEN, environment: "production" }, {}),
		).toEqual({ status: "failed" });
		client.close();
	});
});
