import type { Db } from "mongodb";
import type Provider from "oidc-provider";
import { z } from "zod";
import { STATIC_CLIENT_IDS, isStaticClientId } from "../oidc/clients.js";
import { collectionNameFor } from "../oidc/mongo-adapter.js";

const storedGrant = z.object({
	_id: z.string(),
	expiresAt: z.date().optional(),
	payload: z.object({
		accountId: z.string(),
		clientId: z.string(),
		iat: z.number().optional(),
		openid: z.object({ scope: z.string().optional() }).optional(),
		resources: z.record(z.string(), z.string()).optional(),
	}),
});

interface DeviceMetaDocument {
	_id: string;
	accountId: string;
	/** Missing when the CLI sent neither a machine name nor a User-Agent. */
	deviceName?: string;
	ip?: string;
	userAgent?: string;
	createdAt: Date;
	expiresAt: Date;
}

export const GRANT_META_COLLECTION = "grant_meta";

export interface GrantSummary {
	readonly grantId: string;
	readonly clientId: string;
	readonly scopes: readonly string[];
	readonly grantedAt?: Date;
	readonly expiresAt?: Date;
}

export interface DeviceGrant extends GrantSummary {
	readonly deviceName?: string;
}

/**
 * The newest 200 grants of an account for display, excluding the portal's
 * own. Revocation never relies on this list (see revoke-access.ts).
 */
export async function listGrants(
	db: Db,
	accountId: string,
): Promise<GrantSummary[]> {
	const documents = await db
		.collection(collectionNameFor("Grant"))
		.find({
			"payload.accountId": accountId,
			$or: [
				{ expiresAt: { $exists: false } },
				{ expiresAt: { $gt: new Date() } },
			],
		})
		// Newest first, ties broken by id, so the page is stable.
		.sort({ "payload.iat": -1, _id: 1 })
		.limit(200)
		.toArray();
	return documents
		.map((document) => storedGrant.safeParse(document))
		.flatMap((parsed) => (parsed.success ? [parsed.data] : []))
		.filter(
			({ payload }) => payload.clientId !== STATIC_CLIENT_IDS.accountPortal,
		)
		.map(({ _id, expiresAt, payload }) => ({
			grantId: _id,
			clientId: payload.clientId,
			scopes: [
				...(payload.openid?.scope?.split(" ") ?? []),
				...Object.values(payload.resources ?? {}).flatMap((scope) =>
					scope.split(" "),
				),
			].filter(Boolean),
			grantedAt: payload.iat ? new Date(payload.iat * 1000) : undefined,
			expiresAt,
		}));
}

/** Remembers which machine a Tunelo CLI grant belongs to. */
export async function recordDeviceGrant(
	db: Db,
	meta: Omit<DeviceMetaDocument, "createdAt" | "expiresAt">,
	ttlSeconds: number,
): Promise<void> {
	const now = new Date();
	await db.collection<DeviceMetaDocument>(GRANT_META_COLLECTION).replaceOne(
		{ _id: meta._id },
		{
			...meta,
			createdAt: now,
			expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
		},
		{ upsert: true },
	);
}

/** Tunelo CLI grants with the device name captured at approval. */
export async function listDeviceGrants(
	db: Db,
	grants: readonly GrantSummary[],
): Promise<DeviceGrant[]> {
	const devices = grants.filter(
		(grant) => grant.clientId === STATIC_CLIENT_IDS.tuneloCli,
	);
	const metas = await db
		.collection<DeviceMetaDocument>(GRANT_META_COLLECTION)
		.find({ _id: { $in: devices.map((grant) => grant.grantId) } })
		.toArray();
	const names = new Map(metas.map((meta) => [meta._id, meta.deviceName]));
	return devices.map((grant) => ({
		...grant,
		deviceName: names.get(grant.grantId) ?? undefined,
	}));
}

export interface AuthorizedApp {
	readonly clientId: string;
	readonly name: string;
	readonly firstParty: boolean;
	readonly redirectHosts: readonly string[];
	readonly scopes: readonly string[];
	readonly grantIds: readonly string[];
}

/** Grants other than Tunelo devices, grouped per client. */
export async function listAuthorizedApps(
	provider: Provider,
	grants: readonly GrantSummary[],
): Promise<AuthorizedApp[]> {
	const byClient = new Map<string, GrantSummary[]>();
	for (const grant of grants) {
		if (grant.clientId === STATIC_CLIENT_IDS.tuneloCli) continue;
		byClient.set(grant.clientId, [
			...(byClient.get(grant.clientId) ?? []),
			grant,
		]);
	}
	return Promise.all(
		[...byClient].map(async ([clientId, clientGrants]) => {
			const client = await provider.Client.find(clientId);
			return {
				clientId,
				name: client?.clientName ?? clientId,
				firstParty: isStaticClientId(clientId),
				redirectHosts: [
					...new Set(
						(client?.redirectUris ?? []).flatMap((uri) => {
							const host = URL.parse(uri)?.host;
							return host ? [host] : [];
						}),
					),
				],
				scopes: [...new Set(clientGrants.flatMap((grant) => grant.scopes))],
				grantIds: clientGrants.map((grant) => grant.grantId),
			};
		}),
	);
}

/**
 * Revokes a grant the account owns: deletes its refresh tokens, opaque
 * access tokens, codes and device codes, then the grant. JWT access tokens
 * cannot be recalled and lapse within their 15-minute lifetime.
 */
export async function revokeGrant(
	provider: Provider,
	accountId: string,
	grantId: string,
): Promise<boolean> {
	const grant = await provider.Grant.find(grantId);
	if (!grant || grant.accountId !== accountId) return false;
	await Promise.all([
		provider.AccessToken.revokeByGrantId(grantId),
		provider.RefreshToken.revokeByGrantId(grantId),
		provider.AuthorizationCode.revokeByGrantId(grantId),
		provider.DeviceCode.revokeByGrantId(grantId),
	]);
	await grant.destroy();
	return true;
}
