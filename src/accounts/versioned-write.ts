import type { Collection, Filter, UpdateFilter } from "mongodb";
import type { TenantFilter } from "../tenants/tenant-data.js";
import { translateConflicts } from "./account-conflicts.js";
import type { AccountDocument } from "./user-model.js";

/** Outcome of a security-relevant write. */
export type GuardedWrite =
	| {
			readonly applied: true;
			/** The account's securityVersion this write produced. */
			readonly version: number;
	  }
	| {
			readonly applied: false;
			/**
			 * True when the account moved past the expected version (the token
			 * that allowed this write is stale); false when only the write's
			 * own precondition failed (e.g. nothing to unlink).
			 */
			readonly stale: boolean;
	  };

/** Matches an account at exactly `version` (absent counts as 0). */
function atVersion(version: number): Filter<AccountDocument> {
	return version === 0
		? { $or: [{ securityVersion: 0 }, { securityVersion: { $exists: false } }] }
		: { securityVersion: version };
}

/**
 * Applies `update` (which must `$inc` securityVersion) to one account,
 * atomically conditioned on `precondition` and, when given, on the account
 * still being at `expectedVersion`: the version a token was checked against.
 * So a change slipped in between checking a token and acting on it makes
 * the action fail instead of acting on a newer state.
 */
export async function writeWithVersion(
	accounts: Collection<AccountDocument>,
	scope: TenantFilter,
	id: string,
	expectedVersion: number | undefined,
	precondition: Filter<AccountDocument>,
	update: UpdateFilter<AccountDocument>,
): Promise<GuardedWrite> {
	const clauses: Filter<AccountDocument>[] = [precondition];
	if (expectedVersion !== undefined) clauses.push(atVersion(expectedVersion));
	const after = await translateConflicts(() =>
		accounts.findOneAndUpdate({ _id: id, ...scope, $and: clauses }, update, {
			returnDocument: "after",
			projection: { securityVersion: 1 },
			ignoreUndefined: true,
		}),
	);
	if (after) return { applied: true, version: after.securityVersion ?? 0 };
	if (expectedVersion === undefined) return { applied: false, stale: false };
	const current = await accounts.findOne(
		{ _id: id, ...scope },
		{ projection: { securityVersion: 1 } },
	);
	return {
		applied: false,
		stale: (current?.securityVersion ?? 0) !== expectedVersion,
	};
}
