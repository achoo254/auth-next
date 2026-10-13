import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { TokenCollection, randomToken } from "../accounts/one-time-tokens.js";
import type { UpstreamProvider } from "../accounts/user-model.js";
import { isUpstreamProvider } from "../accounts/user-model.js";
import { readCookie } from "../http/cookies.js";
import type { Tenancy } from "./tenancy.js";
import type { TenantOwner } from "./tenant-registry.js";
import type { Tenant } from "./tenant.js";

/** An owner's session at a tenant's /admin: short, so changes need a recent proof. */
export const ADMIN_SESSION_SECONDS = 30 * 60;
const HANDOFF_SECONDS = 2 * 60;

export interface AdminSession {
	readonly tenantId: string;
	readonly provider: UpstreamProvider;
	readonly providerId: string;
	/** Random per session; the admin forms' CSRF scope is bound to it. */
	readonly sid: string;
	readonly exp: number;
}

function cookieName(tenant: Pick<Tenant, "issuer">): string {
	return tenant.issuer.startsWith("https:")
		? "__Host-tenant_admin"
		: "tenant_admin";
}

function mac(key: string, payload: string): Buffer {
	return createHmac("sha256", key).update(`tenant-admin\n${payload}`).digest();
}

/**
 * The link that opens a tenant's /admin for its owner. Issued by the
 * primary tenant (where the owner is signed in and proved the domain) into
 * the tenant's own one-time token store; works once, for two minutes.
 */
export async function issueAdminHandoff(
	tenancy: Tenancy,
	tenant: { readonly _id: string; readonly domain: string },
	owner: TenantOwner,
): Promise<string> {
	const token = randomToken();
	await new TokenCollection(tenancy.db, { id: tenant._id }).put(
		"tenant-admin-handoff",
		token,
		{ provider: owner.provider, providerId: owner.providerId },
		HANDOFF_SECONDS,
	);
	const url = new URL(`https://auth.${tenant.domain}/admin/handoff`);
	url.searchParams.set("token", token);
	return url.href;
}

/** Consumes a handoff token at the tenant; its owner identity, if valid. */
export async function takeAdminHandoff(
	tenancy: Tenancy,
	tenant: Pick<Tenant, "id">,
	token: string,
): Promise<TenantOwner | undefined> {
	const data = await new TokenCollection(tenancy.db, tenant).take(
		"tenant-admin-handoff",
		token,
	);
	const provider = data?.provider;
	const providerId = data?.providerId;
	return isUpstreamProvider(provider) && providerId
		? { provider, providerId }
		: undefined;
}

/** Starts an admin session (host-only cookie, signed with COOKIE_KEYS). */
export function startAdminSession(
	res: Response,
	tenant: Pick<Tenant, "id" | "issuer">,
	owner: TenantOwner,
	keys: readonly string[],
): void {
	const session: AdminSession = {
		tenantId: tenant.id,
		provider: owner.provider,
		providerId: owner.providerId,
		sid: randomBytes(16).toString("base64url"),
		exp: Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS,
	};
	const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
	const key = keys[0];
	if (!key) throw new Error("Admin sessions need a cookie key");
	res.cookie(
		cookieName(tenant),
		`${payload}.${mac(key, payload).toString("base64url")}`,
		{
			httpOnly: true,
			sameSite: "lax",
			secure: tenant.issuer.startsWith("https:"),
			path: "/",
			maxAge: ADMIN_SESSION_SECONDS * 1000,
		},
	);
}

function parseSession(json: string): AdminSession | undefined {
	const value: unknown = JSON.parse(json);
	if (typeof value !== "object" || value === null) return undefined;
	const field = (name: string): unknown => Reflect.get(value, name);
	const provider = field("provider");
	const [tenantId, providerId, sid, exp] = [
		"tenantId",
		"providerId",
		"sid",
		"exp",
	].map(field);
	return typeof tenantId === "string" &&
		isUpstreamProvider(provider) &&
		typeof providerId === "string" &&
		typeof sid === "string" &&
		typeof exp === "number"
		? { tenantId, provider, providerId, sid, exp }
		: undefined;
}

/**
 * The admin session of this request: signed with a current or older cookie
 * key, unexpired, for this tenant and still for its owner (an owner change
 * ends it).
 */
export function readAdminSession(
	req: Request,
	tenant: Pick<Tenant, "id" | "issuer">,
	owner: TenantOwner | undefined,
	keys: readonly string[],
): AdminSession | undefined {
	const raw = readCookie(req, cookieName(tenant));
	const [payload, signature] = raw?.split(".") ?? [];
	if (!payload || !signature || !owner) return undefined;
	const received = Buffer.from(signature, "base64url");
	const valid = keys.some((key) => {
		const expected = mac(key, payload);
		return (
			received.length === expected.length && timingSafeEqual(received, expected)
		);
	});
	if (!valid) return undefined;
	let session: AdminSession | undefined;
	try {
		session = parseSession(Buffer.from(payload, "base64url").toString("utf8"));
	} catch {
		return undefined;
	}
	if (!session || session.exp < Math.floor(Date.now() / 1000)) return undefined;
	const same =
		session.tenantId === tenant.id &&
		session.provider === owner.provider &&
		session.providerId === owner.providerId;
	return same ? session : undefined;
}

export function endAdminSession(
	res: Response,
	tenant: Pick<Tenant, "issuer">,
): void {
	res.clearCookie(cookieName(tenant), {
		httpOnly: true,
		sameSite: "lax",
		secure: tenant.issuer.startsWith("https:"),
		path: "/",
	});
}
