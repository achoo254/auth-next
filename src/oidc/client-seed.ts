import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import type { Env } from "../config/env.js";
import { createLogger } from "../logger.js";
import {
	envClientSecrets,
	envMiuClients,
	envScribeClients,
	envSignInOnlyApps,
	envTenant,
} from "../tenants/env-tenant.js";
import { inTenant } from "../tenants/tenant-data.js";
import { createInMemoryAccountStore } from "./claims.js";
import { STATIC_CLIENT_IDS, TOKEN_EXCHANGE_GRANT } from "./clients.js";
import { RSA_ID_TOKEN_ALG, SIGNING_ALG, type SigningJwks } from "./jwks.js";
import { isMiuClientId } from "./miu-clients.js";
import { collectionNameFor } from "./mongo-adapter.js";
import { createProvider } from "./provider.js";
import { isScribeClientId } from "./scribe-clients.js";
import { isSignInOnlyClientId } from "./sign-in-only-clients.js";

/** One static client as oidc-provider validated it; never its secret. */
export interface StaticClientSummary {
	readonly clientId: string;
	readonly name: string;
	readonly authMethod: string;
	readonly secret: "configured" | "none";
	readonly grantTypes: readonly string[];
	readonly redirectUris: readonly string[];
	readonly backchannelLogoutUri?: string;
	readonly scope: string;
	readonly allowedResources: readonly string[];
}

export interface ClientSeedReport {
	readonly issuer: string;
	readonly clients: readonly StaticClientSummary[];
	/** sha256 of `clients`: equal on every run and host with the same config. */
	readonly fingerprint: string;
	/** Clients registered through DCR (stored in MongoDB). */
	readonly dynamicClients: number;
	/** Static ids also present in MongoDB (the static definition wins). */
	readonly shadowedIds: readonly string[];
}

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/** Static clients that exist only when the environment configures them. */
function isOptionalClientId(clientId: string): boolean {
	return (
		isScribeClientId(clientId) ||
		isMiuClientId(clientId) ||
		isSignInOnlyClientId(clientId)
	);
}

/**
 * Static clients live in code (`clients.ts`) and are built from the
 * environment, so a deployment never has to write them to MongoDB. This
 * "seed" therefore only proves the deployment will serve them: every
 * client passes oidc-provider's own validation with this environment, and
 * nothing in MongoDB shadows a static id. It reads, it never writes.
 */
export async function inspectStaticClients(deps: {
	readonly env: Env;
	readonly db: Db;
	readonly jwks: SigningJwks;
}): Promise<ClientSeedReport> {
	const tenant = envTenant(deps.env);
	const provider = createProvider({
		tenant,
		db: deps.db,
		jwks: deps.jwks,
		cookieKeys: deps.env.COOKIE_KEYS,
		chatMobileRedirectUri: deps.env.CHAT_MOBILE_REDIRECT_URI,
		scribeClients: envScribeClients(deps.env),
		miuClients: envMiuClients(deps.env),
		signInOnlyApps: envSignInOnlyApps(deps.env),
		clientSecrets: envClientSecrets(deps.env),
		accountStore: createInMemoryAccountStore([]),
		logger: createLogger("silent"),
	});
	const clients: StaticClientSummary[] = [];
	for (const clientId of Object.values(STATIC_CLIENT_IDS)) {
		const client = await provider.Client.find(clientId);
		// Scribe's, Miu's, Tiểu Đệ's, Tử Vi's and Clip's exist only when configured.
		if (!client && isOptionalClientId(clientId)) continue;
		if (!client) throw new Error(`Static client ${clientId} is missing`);
		const metadata = client.metadata();
		const backchannel = text(metadata.backchannel_logout_uri);
		clients.push({
			clientId,
			name: text(metadata.client_name),
			authMethod: text(metadata.token_endpoint_auth_method),
			secret: text(metadata.client_secret) ? "configured" : "none",
			grantTypes: strings(metadata.grant_types),
			redirectUris: strings(metadata.redirect_uris),
			...(backchannel ? { backchannelLogoutUri: backchannel } : {}),
			scope: text(metadata.scope),
			allowedResources: strings(metadata.allowed_resources),
		});
	}
	const stored = deps.db.collection<{ _id: string }>(
		collectionNameFor("Client"),
	);
	const staticIds: string[] = Object.values(STATIC_CLIENT_IDS);
	const shadowed = await stored
		.find(
			{ _id: { $in: staticIds }, ...inTenant(tenant) },
			{ projection: { _id: 1 } },
		)
		.toArray();
	return {
		issuer: tenant.issuer,
		clients,
		fingerprint: createHash("sha256")
			.update(JSON.stringify(clients))
			.digest("hex"),
		dynamicClients: await stored.countDocuments({
			_id: { $nin: staticIds },
			...inTenant(tenant),
		}),
		shadowedIds: shadowed.map((document) => document._id).sort(),
	};
}

function objectOf(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null
		? Object.fromEntries(Object.entries(value))
		: {};
}

/**
 * Checks the deployed issuer serves what this configuration expects: its
 * discovery names the issuer, token exchange, device flow, back-channel
 * logout, ES256 and RS256 (OpenID Connect Discovery requires RS256 among
 * the ID token algorithms, ADR 0005), and its JWKS publishes every local
 * signing key. Returns the problems found (empty when all is well).
 */
export async function checkDiscovery(
	issuer: string,
	signingKids: readonly string[],
	fetchFn: typeof fetch = fetch,
): Promise<string[]> {
	const response = await fetchFn(`${issuer}/.well-known/openid-configuration`);
	if (!response.ok) return [`discovery answered HTTP ${response.status}`];
	const discovery = objectOf(await response.json());
	const problems: string[] = [];
	if (discovery.issuer !== issuer) problems.push("issuer does not match");
	const grants = strings(discovery.grant_types_supported);
	for (const grant of [TOKEN_EXCHANGE_GRANT, "refresh_token"]) {
		if (!grants.includes(grant)) problems.push(`grant ${grant} missing`);
	}
	if (typeof discovery.device_authorization_endpoint !== "string") {
		problems.push("device flow missing");
	}
	if (discovery.backchannel_logout_supported !== true) {
		problems.push("back-channel logout missing");
	}
	const idTokenAlgs = strings(discovery.id_token_signing_alg_values_supported);
	for (const alg of [SIGNING_ALG, RSA_ID_TOKEN_ALG]) {
		if (!idTokenAlgs.includes(alg)) problems.push(`${alg} missing`);
	}
	const jwksUri = text(discovery.jwks_uri);
	if (!jwksUri) return [...problems, "jwks_uri missing"];
	const jwks = objectOf(await (await fetchFn(jwksUri)).json());
	const kids = (Array.isArray(jwks.keys) ? jwks.keys : []).map(
		(key) => objectOf(key).kid,
	);
	for (const kid of signingKids) {
		if (!kids.includes(kid)) {
			problems.push(`signing key ${kid} is not published at ${jwksUri}`);
		}
	}
	return problems;
}

/** Human-readable plan; contains no secret. */
export function formatSeedReport(report: ClientSeedReport): string {
	const lines = [`Issuer ${report.issuer}: static clients (defined in code)`];
	for (const client of report.clients) {
		lines.push(
			`- ${client.clientId} "${client.name}": auth ${client.authMethod}, secret ${client.secret}`,
			`    grants ${client.grantTypes.join(" ") || "(none)"}`,
			`    scope ${client.scope}`,
			`    resources ${client.allowedResources.join(" ") || "(none)"}`,
			`    redirect ${client.redirectUris.join(" ") || "(none)"}`,
		);
		if (client.backchannelLogoutUri) {
			lines.push(`    back-channel logout ${client.backchannelLogoutUri}`);
		}
	}
	lines.push(
		`Dynamic (DCR) clients in MongoDB: ${report.dynamicClients}`,
		`Static ids shadowed in MongoDB: ${report.shadowedIds.join(", ") || "none"}`,
		`Fingerprint ${report.fingerprint}`,
		"Writes: none (static clients are served from code)",
	);
	return lines.join("\n");
}
