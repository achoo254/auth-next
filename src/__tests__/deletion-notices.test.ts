import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteAccount } from "../account-portal/account-deletion.js";
import {
	ACCOUNT_DELETED_EVENT,
	DeletionNoticeDispatcher,
	deletionNoticeSigner,
} from "../deletion-notices/deletion-notice-dispatcher.js";
import {
	DELETION_NOTICES_COLLECTION,
	type DeletionNoticeDocument,
	DeletionNotices,
} from "../deletion-notices/deletion-notice-queue.js";
import { createTestAccount, repositoryOf } from "./helpers/test-accounts.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

const CHAT = "https://chat.example.test/api/idp/account-deleted";
const KB = "https://kb.example.test/api/idp/account-deleted";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

function noticesOf(sub: string) {
	return idp.db
		.collection<DeletionNoticeDocument>(DELETION_NOTICES_COLLECTION)
		.find({ sub })
		.toArray();
}

interface Sent {
	readonly url: string;
	readonly body: string;
	readonly type: string | null;
}

function dispatcher(
	status: (url: string) => number,
	sent: Sent[],
	now: () => Date = () => new Date(),
): DeletionNoticeDispatcher {
	return new DeletionNoticeDispatcher({
		notices: new DeletionNotices(idp.db, idp.tenant),
		sign: deletionNoticeSigner({ issuer: idp.issuer, jwks: idp.jwks }),
		logger: idp.services.logger,
		now,
		fetch: async (url, init) => {
			sent.push({
				url: String(url),
				body: String(init?.body),
				type: new Headers(init?.headers).get("content-type"),
			});
			return new Response(null, { status: status(String(url)) });
		},
	});
}

describe("telling the apps of an account deletion", () => {
	it("queues one notice per configured app when an account is deleted", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const services = { ...idp.services, accountDeletedUrls: [CHAT, KB] };
		expect(await deleteAccount(services, account._id, "web")).toBe("deleted");
		const notices = await noticesOf(account._id);
		expect(notices.map((notice) => notice.url).sort()).toEqual([CHAT, KB]);
	});

	it("sends a signed SET each app can check, then forgets the notice", async () => {
		const sub = `acc_${Date.now()}`;
		await new DeletionNotices(idp.db, idp.tenant).enqueue(sub, [CHAT]);
		const [queued] = await noticesOf(sub);
		const sent: Sent[] = [];
		await dispatcher(() => 202, sent).dispatchDue();

		const mine = sent.filter((request) => request.body.length > 0);
		const token = mine.at(-1)?.body ?? "";
		expect(mine.at(-1)?.type).toBe("application/secevent+jwt");
		expect(decodeProtectedHeader(token)).toMatchObject({
			alg: "ES256",
			typ: "secevent+jwt",
		});
		const discovery = (await (
			await fetch(`${idp.issuer}/.well-known/openid-configuration`)
		).json()) as { jwks_uri: string };
		const { payload } = await jwtVerify(
			token,
			createRemoteJWKSet(new URL(discovery.jwks_uri)),
			{ issuer: idp.issuer, audience: CHAT, typ: "secevent+jwt" },
		);
		expect(payload.sub).toBe(sub);
		expect(payload.jti).toBe(queued?._id);
		expect(payload.events).toEqual({ [ACCOUNT_DELETED_EVENT]: {} });
		expect(await noticesOf(sub)).toEqual([]);
	});

	it("keeps a notice the app refused and retries it later with the same jti", async () => {
		const sub = `acc_retry_${Date.now()}`;
		await new DeletionNotices(idp.db, idp.tenant).enqueue(sub, [KB]);
		const [queued] = await noticesOf(sub);
		const sent: Sent[] = [];
		const down = dispatcher((url) => (url === KB ? 503 : 202), sent);
		await down.dispatchDue();
		const [kept] = await noticesOf(sub);
		expect(kept?.attempts).toBe(1);
		expect(kept?.lastError).toBe("HTTP 503");
		expect(kept?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

		// Once the backoff has passed, the app is back.
		const later = () => new Date(Date.now() + 60_000);
		await dispatcher(() => 202, sent, later).dispatchDue();
		expect(await noticesOf(sub)).toEqual([]);
		const tokens = sent
			.filter((request) => request.url === KB)
			.map((request) => decodeJti(request.body));
		expect(tokens).toContain(queued?._id);
	});
});

function decodeJti(token: string): unknown {
	const [, payload = ""] = token.split(".");
	const decoded: unknown = JSON.parse(
		Buffer.from(payload, "base64url").toString("utf8"),
	);
	return typeof decoded === "object" && decoded !== null
		? Reflect.get(decoded, "jti")
		: undefined;
}
