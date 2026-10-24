import type { ClientMetadata } from "oidc-provider";
import { PRIMARY_TENANT_ID } from "../tenants/env-tenant.js";
import type { Tenant } from "../tenants/tenant.js";
import { ALLOWED_RESOURCES_PROPERTY } from "./resources.js";

/**
 * Apps served for the primary tenant only (Scribe, Miu World) share one
 * shape: a confidential web client used by the app's server (BFF), a public
 * native client with a private-use scheme redirect, and an optional web
 * client for a developer's own machine (loopback).
 */

/** A web deployment of such an app: its origin and its client secret. */
export interface PrimaryWebApp {
	readonly url: string;
	readonly secret: string;
}

/**
 * What the primary tenant's environment configures for one app. `web`
 * enables the web and mobile clients; `dev` enables the development client
 * (and the mobile one, so the app can be tried before the site is live).
 */
export interface PrimaryAppClientsConfig {
	readonly web?: PrimaryWebApp;
	readonly mobileRedirectUri: string;
	readonly dev?: PrimaryWebApp;
}

/** The fixed parts of one app's clients. */
export interface PrimaryAppSpec {
	readonly ids: {
		readonly web: string;
		readonly mobile: string;
		readonly webDev: string;
	};
	readonly name: string;
	readonly scope: string;
	/** Grants of every client of the app (refresh only if the app uses it). */
	readonly grantTypes: readonly string[];
	readonly callbackPath: string;
	readonly backchannelLogoutPath: string;
}

/**
 * A confidential web client: Code + PKCE (oidc-provider requires PKCE for
 * every client here), no API resource.
 */
export function webClient(
	spec: PrimaryAppSpec,
	clientId: string,
	app: PrimaryWebApp,
	backchannel: boolean,
): ClientMetadata {
	const at = (path: string): string => new URL(path, app.url).href;
	return {
		client_id: clientId,
		client_name: spec.name,
		client_secret: app.secret,
		token_endpoint_auth_method: "client_secret_basic",
		grant_types: [...spec.grantTypes],
		response_types: ["code"],
		redirect_uris: [at(spec.callbackPath)],
		post_logout_redirect_uris: [at("/")],
		...(backchannel
			? {
					backchannel_logout_uri: at(spec.backchannelLogoutPath),
					backchannel_logout_session_required: true,
				}
			: {}),
		scope: spec.scope,
		[ALLOWED_RESOURCES_PROPERTY]: [],
	};
}

/**
 * The clients of one primary-tenant app for `tenant`: those `config`
 * enables, for the primary tenant only. Other tenants have no host for the
 * app and must never accept a redirect to the primary tenant's, whatever is
 * passed.
 */
export function buildPrimaryAppClients(
	spec: PrimaryAppSpec,
	tenant: Pick<Tenant, "id">,
	config: PrimaryAppClientsConfig | undefined,
): ClientMetadata[] {
	if (!config || tenant.id !== PRIMARY_TENANT_ID) return [];
	const clients: ClientMetadata[] = [];
	if (config.web) {
		clients.push(webClient(spec, spec.ids.web, config.web, true));
	}
	// The app's redirect is its own URL scheme, not a web origin: it also
	// exists with only the development client, so the app can be tried
	// against a developer's server before the production site is live.
	if (config.web || config.dev) {
		clients.push({
			client_id: spec.ids.mobile,
			client_name: spec.name,
			application_type: "native",
			token_endpoint_auth_method: "none",
			grant_types: [...spec.grantTypes],
			response_types: ["code"],
			redirect_uris: [config.mobileRedirectUri],
			scope: spec.scope,
			[ALLOWED_RESOURCES_PROPERTY]: [],
		});
	}
	// Local development has no reachable back-channel endpoint.
	if (config.dev) {
		clients.push(webClient(spec, spec.ids.webDev, config.dev, false));
	}
	return clients;
}
