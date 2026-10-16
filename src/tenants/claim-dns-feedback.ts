import type { ClaimError } from "./claim-service.js";
import { type AppHostKey, isAppHostKey } from "./ownership-records.js";

/** Which records of which pending claim are not right yet, as the page shows them. */
export interface WrongRecords {
	readonly claimId: string;
	readonly hosts: readonly AppHostKey[];
}

/**
 * Query of the redirect after a failed verification: the error, and for a
 * wrong address the claim and its host keys (fixed names, never DNS data),
 * so the page can mark the rows to fix.
 */
export function verifyFailureQuery(
	error: ClaimError,
	claimId: string,
	wrongHosts: readonly AppHostKey[] = [],
): string {
	const query = new URLSearchParams({ error });
	if (error === "dns-address" && wrongHosts.length > 0) {
		query.set("claim", claimId);
		query.set("hosts", wrongHosts.join(","));
	}
	return query.toString();
}

/** Reads `verifyFailureQuery` back; anything unexpected is ignored. */
export function wrongRecordsFrom(query: unknown): WrongRecords | undefined {
	if (typeof query !== "object" || query === null) return undefined;
	const claimId: unknown = Reflect.get(query, "claim");
	const hosts: unknown = Reflect.get(query, "hosts");
	if (typeof claimId !== "string" || typeof hosts !== "string")
		return undefined;
	const keys = hosts.split(",").filter(isAppHostKey);
	return keys.length > 0 ? { claimId, hosts: keys } : undefined;
}
