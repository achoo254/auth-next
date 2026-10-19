import type Provider from "oidc-provider";
import { z } from "zod";
import { STATIC_CLIENT_IDS, isStaticClientId } from "../oidc/clients.js";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import { type TenantDb, inTenant } from "../tenants/tenant-data.js";
import { grantsPerDevice } from "./device-grants.js";

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

export interface GrantSummary {
	readonly grantId: string;
	readonly clientId: string;
	readonly scopes: readonly string[];
	readonly grantedAt?: Date;
	readonly expiresAt?: Date;
}

/**
 * The newest 200 grants of an account for display, excluding the portal's
 * own. Revocation never relies on this list (see revoke-access.ts).
 */
export async function listGrants(
	{ db, tenant }: TenantDb,
	accountId: string,
): Promise<GrantSummary[]> {
	const documents = await db
		.collection(collectionNameFor("Grant"))
		.find({
			"payload.accountId": accountId,
			...inTenant(tenant),
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

export interface AuthorizedApp {
	readonly clientId: string;
	readonly name: string;
	readonly firstParty: boolean;
	readonly redirectHosts: readonly string[];
	readonly scopes: readonly string[];
	readonly grantIds: readonly string[];
}

/** Grants other than per-device ones (device-grants.ts), grouped per client. */
export async function listAuthorizedApps(
	provider: Provider,
	grants: readonly GrantSummary[],
): Promise<AuthorizedApp[]> {
	const byClient = new Map<string, GrantSummary[]>();
	for (const grant of grants) {
		if (grantsPerDevice(grant.clientId)) continue;
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
