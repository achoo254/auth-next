import { randomBytes } from "node:crypto";
import { getDomain } from "tldts";

const API = "https://api.cloudflare.com/client/v4";

/** Why a Cloudflare API token is refused; the token itself is never logged. */
export type CloudflareTokenCheck =
	| "ok"
	| "invalid"
	| "no-zone"
	| "no-dns-edit"
	| "unreachable";

interface ApiResult {
	readonly success: boolean;
	readonly result?: unknown;
}

async function call(
	fetchFn: typeof fetch,
	token: string,
	path: string,
	init: { method?: string; body?: object } = {},
): Promise<ApiResult> {
	const response = await fetchFn(`${API}${path}`, {
		method: init.method ?? "GET",
		headers: {
			authorization: `Bearer ${token}`,
			...(init.body ? { "content-type": "application/json" } : {}),
		},
		body: init.body ? JSON.stringify(init.body) : undefined,
		redirect: "error",
		signal: AbortSignal.timeout(10_000),
	});
	const body: unknown = await response.json().catch(() => undefined);
	const success =
		response.ok &&
		typeof body === "object" &&
		body !== null &&
		Reflect.get(body, "success") === true;
	return {
		success,
		result:
			typeof body === "object" && body !== null
				? Reflect.get(body, "result")
				: undefined,
	};
}

function idOf(value: unknown): string | undefined {
	const id =
		typeof value === "object" && value !== null
			? Reflect.get(value, "id")
			: undefined;
	return typeof id === "string" ? id : undefined;
}

/**
 * Checks a token before it is kept for DNS-01 certificates: it is active,
 * it sees the zone of `domain`, and it can edit DNS there (a throwaway TXT
 * record is created and deleted again). Anything less would only fail
 * later, at issuance or renewal.
 */
export async function checkCloudflareToken(
	fetchFn: typeof fetch,
	token: string,
	domain: string,
): Promise<CloudflareTokenCheck> {
	try {
		const verify = await call(fetchFn, token, "/user/tokens/verify");
		const status =
			typeof verify.result === "object" && verify.result !== null
				? Reflect.get(verify.result, "status")
				: undefined;
		if (!verify.success || status !== "active") return "invalid";
		const zoneName = getDomain(domain, { allowPrivateDomains: true }) ?? domain;
		const zones = await call(
			fetchFn,
			token,
			`/zones?name=${encodeURIComponent(zoneName)}`,
		);
		const zoneId = Array.isArray(zones.result)
			? idOf(zones.result[0])
			: undefined;
		if (!zones.success || !zoneId) return "no-zone";
		const zone = encodeURIComponent(zoneId);
		const created = await call(fetchFn, token, `/zones/${zone}/dns_records`, {
			method: "POST",
			body: {
				type: "TXT",
				name: `_auth-dns-check.${domain}`,
				content: randomBytes(12).toString("hex"),
				ttl: 60,
			},
		});
		const recordId = idOf(created.result);
		if (!created.success || !recordId) return "no-dns-edit";
		await call(
			fetchFn,
			token,
			`/zones/${zone}/dns_records/${encodeURIComponent(recordId)}`,
			{
				method: "DELETE",
			},
		);
		return "ok";
	} catch {
		return "unreachable";
	}
}
