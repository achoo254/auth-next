// Counts, or with CONFIRM=1 deletes, the documents of TENANT_ID in every
// collection of the database of MONGO_URI (Localman's and Tunelo's: all of
// their collections are tenant-scoped). Run by purge-tenant.sh with
// `node --input-type=module -e` in the IdP's folder, for its mongodb
// driver. Prints collection names and counts, never the URI.
import { MongoClient } from "mongodb";

const { MONGO_URI, TENANT_ID, CONFIRM } = process.env;
if (!MONGO_URI || !TENANT_ID || TENANT_ID === "primary") {
	throw new Error("MONGO_URI and a TENANT_ID other than primary are needed");
}
const client = await MongoClient.connect(MONGO_URI);
try {
	const db = client.db();
	for (const { name } of await db
		.listCollections({ type: "collection" })
		.toArray()) {
		const collection = db.collection(name);
		const count = await collection.countDocuments({ tenantId: TENANT_ID });
		if (count === 0) continue;
		if (CONFIRM === "1") await collection.deleteMany({ tenantId: TENANT_ID });
		process.stdout.write(
			`${db.databaseName}.${name}: ${count}${CONFIRM === "1" ? " deleted" : ""}\n`,
		);
	}
} finally {
	await client.close();
}
