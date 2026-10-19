import type {
	AccountDocument,
	UpstreamProvider,
} from "../accounts/user-model.js";
import type { AppServices } from "../services.js";

/**
 * After an unlink: tells the provider the authorization is over, when the
 * link kept a revocation token (Apple requires it). Best effort: the link
 * is already gone, so a failure is only logged, never the token.
 */
export async function revokeUnlinked(
	services: AppServices,
	account: Pick<AccountDocument, "providerDetails">,
	provider: UpstreamProvider,
): Promise<void> {
	const token = account.providerDetails?.[provider]?.revocationToken;
	if (!token) return;
	const client = services.upstreams.get(provider);
	if (!client?.revoke) {
		services.logger.warn({ provider }, "Unlinked without revoking: disabled");
		return;
	}
	try {
		await client.revoke(token);
	} catch (error) {
		services.logger.warn(
			{ provider, reason: error instanceof Error ? error.name : "unknown" },
			"Revocation at the provider failed",
		);
	}
}
