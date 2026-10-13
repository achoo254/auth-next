import type { AuditDeliveryConfig } from "../config/integrations-env.js";
import type { SigningJwks } from "../oidc/jwks.js";
import { PRIMARY_TENANT_ID } from "../tenants/env-tenant.js";
import { type Tenant, appHostsFor } from "../tenants/tenant.js";
import type {
	AuditDelivery,
	AuditDeliveryResolver,
} from "./audit-dispatcher.js";
import { createSecurityEventSigner } from "./security-event-token.js";

/** Localman's audit intake of a registry tenant, by convention. */
export function auditIntakeUrl(domain: string): string {
	return `https://${appHostsFor(domain).localman}/internal/audit-events`;
}

export interface AuditDeliveryResolverOptions {
	/** The primary tenant's target (AUDIT_EVENTS_URL), issuer and keys. */
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
 * Where each event goes and who signs it: the tenant the event belongs to.
 * The primary tenant keeps `AUDIT_EVENTS_URL`; a registry tenant's events
 * go to its own Localman, signed with its own keys as its own issuer, with
 * the same Basic credentials (Localman tells tenants apart by `iss`). A
 * registry tenant is looked up for every event, so one suspended meanwhile
 * gets no delivery and its events wait with backoff.
 */
export function createAuditDeliveryResolver(
	options: AuditDeliveryResolverOptions,
): AuditDeliveryResolver {
	const { primary } = options;
	const primaryDelivery: AuditDelivery = {
		config: primary.config,
		sign: createSecurityEventSigner({
			issuer: primary.issuer,
			audience: primary.config.url,
			jwks: primary.jwks,
		}),
	};
	return async (event) => {
		const tenantId = event.tenantId ?? PRIMARY_TENANT_ID;
		if (tenantId === PRIMARY_TENANT_ID) return primaryDelivery;
		const found = await options.tenantKeys(tenantId);
		if (!found) return undefined;
		const url = auditIntakeUrl(found.tenant.domain);
		return {
			config: { ...primary.config, url },
			sign: createSecurityEventSigner({
				issuer: found.tenant.issuer,
				audience: url,
				jwks: found.jwks,
			}),
		};
	};
}
