import type { Db } from "mongodb";
import type { RevocationCause } from "../audit/audit-events.js";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import type { AppServices } from "../services.js";
import { GRANT_META_COLLECTION, revokeGrant } from "./grant-directory.js";
import { revokeSession } from "./session-directory.js";

/** Every grant id of an account (optionally of one client); no page limit. */
export async function grantIdsOf(
	db: Db,
	accountId: string,
	clientId?: string,
): Promise<string[]> {
	const grants = await db
		.collection<{ _id: string }>(collectionNameFor("Grant"))
		.find(
			{
				"payload.accountId": accountId,
				...(clientId ? { "payload.clientId": clientId } : {}),
			},
			{ projection: { _id: 1 } },
		)
		.toArray();
	return grants.map((grant) => grant._id);
}

async function sessionUidsOf(db: Db, accountId: string): Promise<string[]> {
	const sessions = await db
		.collection(collectionNameFor("Session"))
		.find(
			{ "payload.accountId": accountId },
			{ projection: { "payload.uid": 1 } },
		)
		.toArray();
	return sessions.flatMap((document) => {
		const payload: unknown = document.payload;
		const uid: unknown =
			typeof payload === "object" && payload !== null
				? Reflect.get(payload, "uid")
				: undefined;
		return typeof uid === "string" ? [uid] : [];
	});
}

/** Revokes grants (refresh tokens, opaque tokens, codes) and their device names. */
export async function revokeGrants(
	services: AppServices,
	accountId: string,
	grantIds: readonly string[],
): Promise<number> {
	let revoked = 0;
	for (const grantId of grantIds) {
		if (await revokeGrant(services.provider, accountId, grantId)) revoked += 1;
	}
	await services.db
		.collection<{ _id: string }>(GRANT_META_COLLECTION)
		.deleteMany({ _id: { $in: [...grantIds] } });
	return revoked;
}

export interface RevokeScope {
	/** Keep this browser session (the one making the change). */
	readonly exceptSessionUid?: string;
	/** Also revoke every grant: Tunelo devices, apps, MCP clients. */
	readonly grants: boolean;
}

/**
 * Signs an account out everywhere: every IdP browser session (with
 * back-channel logout, as RP-initiated logout does) except the one named,
 * and optionally every grant. Used after a password reset or change and
 * after a security review; what was revoked goes to the audit log.
 */
export async function revokeAccountAccess(
	services: AppServices,
	accountId: string,
	scope: RevokeScope,
	cause: RevocationCause,
): Promise<{ sessions: number; grants: number }> {
	let sessions = 0;
	for (const uid of await sessionUidsOf(services.db, accountId)) {
		if (uid === scope.exceptSessionUid) continue;
		const done = await revokeSession(
			services.provider,
			services.db,
			services.logger,
			accountId,
			uid,
		);
		if (done) sessions += 1;
	}
	const grants = scope.grants
		? await revokeGrants(
				services,
				accountId,
				await grantIdsOf(services.db, accountId),
			)
		: 0;
	if (sessions > 0) {
		await services.audit.record("session.revoked", accountId, {
			count: sessions,
			cause,
		});
	}
	if (grants > 0) {
		await services.audit.record("grant.revoked", accountId, {
			count: grants,
			cause,
		});
	}
	return { sessions, grants };
}
