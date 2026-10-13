import type { AuditDeliveryConfig } from "../config/integrations-env.js";
import type { SigningJwks } from "../oidc/jwks.js";
import { PRIMARY_TENANT_ID } from "../tenants/env-tenant.js";
import type { Tenant } from "../tenants/tenant.js";
import type {
	AuditDelivery,
	AuditDeliveryResolver,
} from "./audit-dispatcher.js";
import { createSecurityEventSigner } from "./security-event-token.js";

export interface AuditDeliveryResolverOptions {
	/** The intake (AUDIT_EVENTS_URL) and the primary tenant's issuer and keys. */
	readonly primary: {
		readonly config: AuditDeliveryConfig;
		readonly issuer: string;
		readonly jwks: SigningJwks;
	};
	/** A serving registry tenant and its signing keys, or undefined. */
	readonly tenantKeys: (
		tenantId: string,
	) => Promise<{ tenant: Tenant; jwks: SigningJwks } | undefined>;
}

/**
 * Who signs each event: the tenant it belongs to, as its own issuer with
 * its own keys. Every event goes to the one intake, AUDIT_EVENTS_URL (one
 * Localman process serves every tenant and tells them apart by `iss`), so
 * the Basic credentials never follow a tenant's DNS. A suspended tenant's
 * events still go out (its keys are kept); a tenant that no longer exists
 * gets no delivery and its events wait with backoff.
 */
export function createAuditDeliveryResolver(
	options: AuditDeliveryResolverOptions,
): AuditDeliveryResolver {
	const { primary } = options;
	const signedBy = (issuer: string, jwks: SigningJwks): AuditDelivery => ({
		config: primary.config,
		sign: createSecurityEventSigner({
			issuer,
			audience: primary.config.url,
			jwks,
		}),
	});
	const primaryDelivery = signedBy(primary.issuer, primary.jwks);
	return async (event) => {
		if (event.tenantId === PRIMARY_TENANT_ID) return primaryDelivery;
		const found = await options.tenantKeys(event.tenantId);
		return found ? signedBy(found.tenant.issuer, found.jwks) : undefined;
	};
}
