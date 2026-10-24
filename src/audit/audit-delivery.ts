import type { AuditDeliveryConfig } from "../config/integrations-env.js";
import type { SigningJwks } from "../oidc/jwks.js";
import type { AuditDeliveryResolver } from "./audit-dispatcher.js";
import { createSecurityEventSigner } from "./security-event-token.js";

export interface AuditDeliveryResolverOptions {
	/** The intake (AUDIT_EVENTS_URL). */
	readonly config: AuditDeliveryConfig;
	/** The tenant's issuer and signing keys: every event is signed as it. */
	readonly issuer: string;
	readonly jwks: SigningJwks;
}

/**
 * Who signs each event and where it goes: the tenant, as its issuer with
 * its keys, to AUDIT_EVENTS_URL. The dispatcher only leases the tenant's
 * own events (its AuditOutbox), so one signer serves them all.
 */
export function createAuditDeliveryResolver(
	options: AuditDeliveryResolverOptions,
): AuditDeliveryResolver {
	const delivery = {
		config: options.config,
		sign: createSecurityEventSigner({
			issuer: options.issuer,
			audience: options.config.url,
			jwks: options.jwks,
		}),
	};
	return async () => delivery;
}
