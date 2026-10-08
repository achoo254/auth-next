import { MongoMemoryServer } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";

declare module "vitest" {
	export interface ProvidedContext {
		/** Base URI of the shared in-memory mongod; each suite picks a database. */
		mongoUri: string;
	}
}

/** One real mongod for the whole run; suites isolate by database name. */
export default async function setup(
	project: TestProject,
): Promise<() => Promise<void>> {
	const mongod = await MongoMemoryServer.create();
	project.provide("mongoUri", mongod.getUri());
	return async () => {
		await mongod.stop();
	};
}
