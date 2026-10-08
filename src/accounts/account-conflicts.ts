import { MongoServerError } from "mongodb";

/** A unique index refused the write (username, email or provider id taken). */
export class AccountConflictError extends Error {
	constructor(readonly field: string) {
		super(`Account ${field} is already in use`);
		this.name = "AccountConflictError";
	}
}

function conflictField(error: unknown): string | undefined {
	if (!(error instanceof MongoServerError) || error.code !== 11000) {
		return undefined;
	}
	const keys: unknown = error.keyPattern;
	if (typeof keys === "object" && keys !== null) {
		return Object.keys(keys)[0] ?? "unknown";
	}
	return "unknown";
}

/** Runs a write, turning a duplicate-key error into AccountConflictError. */
export async function translateConflicts<T>(
	write: () => Promise<T>,
): Promise<T> {
	try {
		return await write();
	} catch (error) {
		const field = conflictField(error);
		if (field) throw new AccountConflictError(field);
		throw error;
	}
}
