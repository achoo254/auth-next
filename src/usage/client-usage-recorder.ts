import type { Collection, Db } from "mongodb";
import type { Logger } from "../logger.js";
import { type TenantScope, tenantTag } from "../tenants/tenant-data.js";
import {
	type ClientUsageDocument,
	type ClientUsageKind,
	clientUsageCollection,
} from "./client-usage-model.js";

/**
 * Writes one `client_usage` document per sign-in into an app, for the
 * tenant it was built for. One caller: the provider's
 * `authorization.success` listener (`recordClientUsage`), once per
 * authorization an app receives.
 *
 * Recording never throws: the sign-in has already happened and must not
 * fail because of a statistic, so a failed write is only logged (client
 * and error name, never the account). CLIENT_USAGE_ENABLED=false turns it
 * into a no-op.
 */
export class ClientUsageRecorder {
	private readonly usage: Collection<ClientUsageDocument>;

	constructor(
		db: Db,
		readonly tenant: TenantScope,
		private readonly logger: Logger,
		readonly enabled: boolean,
	) {
		this.usage = clientUsageCollection(db);
	}

	async record(
		sub: string,
		clientId: string,
		kind: ClientUsageKind,
	): Promise<void> {
		if (!this.enabled || !sub || !clientId) return;
		try {
			await this.usage.insertOne({
				...tenantTag(this.tenant),
				sub,
				clientId,
				at: new Date(),
				kind,
			});
		} catch (error) {
			this.logger.warn(
				{
					clientId,
					kind,
					error: error instanceof Error ? error.name : "error",
				},
				"Client usage not recorded",
			);
		}
	}
}
