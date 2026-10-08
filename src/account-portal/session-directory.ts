import type { Db } from "mongodb";
import type Provider from "oidc-provider";
import type { Logger } from "../logger.js";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import { TTL_SECONDS } from "../oidc/provider.js";
import { revokeGrant } from "./grant-directory.js";

interface SessionMetaDocument {
	/** The provider session's `uid` (stable across id rotation). */
	_id: string;
	accountId: string;
	userAgent?: string;
	ip?: string;
	firstSeenAt: Date;
	lastSeenAt: Date;
	expiresAt: Date;
}

export const SESSION_META_COLLECTION = "session_meta";

export interface OpenSession {
	readonly uid: string;
	readonly loginAt?: Date;
	readonly lastSeenAt?: Date;
	readonly userAgent?: string;
	readonly ip?: string;
}

/**
 * The provider's Session stores no browser details, so every successful
 * authorization records the user agent and IP next to the session uid for
 * the "open sessions" list.
 */
export function trackSessions(
	provider: Provider,
	db: Db,
	logger: Logger,
): void {
	const meta = db.collection<SessionMetaDocument>(SESSION_META_COLLECTION);
	provider.on("authorization.success", (ctx) => {
		const session = ctx.oidc.session;
		if (!session?.accountId || !session.uid) return;
		const now = new Date();
		meta
			.updateOne(
				{ _id: session.uid },
				{
					$set: {
						accountId: session.accountId,
						userAgent: ctx.get("user-agent").slice(0, 300),
						ip: ctx.ip,
						lastSeenAt: now,
						expiresAt: new Date(now.getTime() + TTL_SECONDS.Session * 1000),
					},
					$setOnInsert: { firstSeenAt: now },
				},
				{ upsert: true },
			)
			.catch((error: unknown) => {
				logger.warn({ err: error }, "Could not record session activity");
			});
	});
}

/** Live provider sessions of one account, joined with recorded details. */
export async function listSessions(
	db: Db,
	accountId: string,
): Promise<OpenSession[]> {
	const sessions = await db
		.collection(collectionNameFor("Session"))
		.find(
			{ "payload.accountId": accountId, expiresAt: { $gt: new Date() } },
			{ projection: { "payload.uid": 1, "payload.loginTs": 1 } },
		)
		.limit(100)
		.toArray();
	const rows = sessions.flatMap((document) => {
		const payload: unknown = document.payload;
		if (typeof payload !== "object" || payload === null) return [];
		const uid: unknown = Reflect.get(payload, "uid");
		const loginTs: unknown = Reflect.get(payload, "loginTs");
		if (typeof uid !== "string") return [];
		return [
			{ uid, loginTs: typeof loginTs === "number" ? loginTs : undefined },
		];
	});
	const metas = await db
		.collection<SessionMetaDocument>(SESSION_META_COLLECTION)
		.find({ _id: { $in: rows.map((row) => row.uid) } })
		.toArray();
	const byUid = new Map(metas.map((meta) => [meta._id, meta]));
	return rows
		.map((row) => {
			const details = byUid.get(row.uid);
			return {
				uid: row.uid,
				loginAt: row.loginTs ? new Date(row.loginTs * 1000) : undefined,
				lastSeenAt: details?.lastSeenAt,
				userAgent: details?.userAgent,
				ip: details?.ip,
			};
		})
		.sort((a, b) => (b.loginAt?.getTime() ?? 0) - (a.loginAt?.getTime() ?? 0));
}

type BackchannelLogout = (sub: string, sid: string | undefined) => unknown;

function backchannelLogoutOf(client: object): BackchannelLogout | undefined {
	const method: unknown = Reflect.get(client, "backchannelLogout");
	return typeof method === "function"
		? (sub, sid) => Reflect.apply(method, client, [sub, sid])
		: undefined;
}

/**
 * Signs one session out the way RP-initiated logout does: back-channel
 * logout to the apps that support it, revoke grants that do not outlive the
 * session (offline_access ones do), then delete the session.
 */
export async function revokeSession(
	provider: Provider,
	db: Db,
	logger: Logger,
	accountId: string,
	uid: string,
): Promise<boolean> {
	const session = await provider.Session.findByUid(uid);
	if (!session || session.accountId !== accountId) return false;
	for (const [clientId, authorization] of Object.entries(
		session.authorizations ?? {},
	)) {
		const client = await provider.Client.find(clientId);
		const logout = client?.backchannelLogoutUri
			? backchannelLogoutOf(client)
			: undefined;
		if (logout) {
			await Promise.resolve(logout(accountId, authorization.sid)).catch(
				(error: unknown) => {
					logger.warn({ err: error, clientId }, "Back-channel logout failed");
				},
			);
		}
		if (authorization.grantId && !authorization.persistsLogout) {
			await revokeGrant(provider, accountId, authorization.grantId);
		}
	}
	await session.destroy();
	await db
		.collection<SessionMetaDocument>(SESSION_META_COLLECTION)
		.deleteOne({ _id: uid });
	return true;
}
