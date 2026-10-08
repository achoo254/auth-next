import { type Db, MongoClient } from "mongodb";
import type { Logger } from "../logger.js";

export interface MongoConnection {
	readonly client: MongoClient;
	/** The database named in the connection URI (`auth` in deployments). */
	readonly db: Db;
}

/** Hides credentials so the URI can be logged. */
export function redactMongoUri(uri: string): string {
	return uri.replace(/\/\/[^@/]*@/, "//[redacted]@");
}

/**
 * Connects and verifies the server is reachable. Rejects when no server
 * answers within `serverSelectionTimeoutMS`; later drops are retried by the
 * driver, so only startup fails fast.
 */
export async function connectMongo(
	uri: string,
	logger: Logger,
	serverSelectionTimeoutMS = 5_000,
): Promise<MongoConnection> {
	const target = redactMongoUri(uri);
	logger.info({ uri: target }, "Connecting to MongoDB");
	const client = new MongoClient(uri, { serverSelectionTimeoutMS });
	try {
		await client.connect();
		const db = client.db();
		await db.command({ ping: 1 });
		logger.info({ uri: target, db: db.databaseName }, "MongoDB connected");
		return { client, db };
	} catch (error) {
		await client.close().catch(() => undefined);
		throw new Error(`Cannot connect to MongoDB at ${target}`, { cause: error });
	}
}
