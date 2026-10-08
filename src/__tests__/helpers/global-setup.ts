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
	// Frequent checkpoints keep shutdown short: with the default 60 s, the
	// whole run (thousands of collections created and dropped) is flushed at
	// stop, which can exceed mongodb-memory-server's 10 s SIGINT grace on a
	// busy machine and end in a SIGKILL warning.
	const mongod = await MongoMemoryServer.create({
		instance: { args: ["--syncdelay", "2"] },
	});
	project.provide("mongoUri", mongod.getUri());
	return async () => {
		await mongod.stop();
	};
}
