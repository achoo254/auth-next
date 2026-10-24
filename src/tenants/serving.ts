import type { Express } from "express";
import type { Db } from "mongodb";
import { createApp } from "../app.js";
import { createAuditDeliveryResolver } from "../audit/audit-delivery.js";
import { AuditDispatcher } from "../audit/audit-dispatcher.js";
import type { Env } from "../config/env.js";
import { auditDeliveryConfig } from "../config/integrations-env.js";
import type { Logger } from "../logger.js";
import type { SigningJwks } from "../oidc/jwks.js";
import { type TenantRuntime, buildPrimaryRuntime } from "./tenant-runtime.js";

/** Everything the server process runs, assembled from the environment. */
export interface Serving {
	readonly primary: TenantRuntime;
	/** The public app: the primary tenant at its issuer's host and ALLOWED_HOSTS. */
	readonly app: Express;
	readonly auditDispatcher: AuditDispatcher;
	/** Starts background jobs (audit delivery). */
	start(): void;
	stop(): Promise<void>;
}

/**
 * The primary tenant, served at its issuer's host and ALLOWED_HOSTS (any
 * other Host gets 421), and the dispatcher delivering its audit events.
 */
export function createServing(
	env: Env,
	db: Db,
	jwks: SigningJwks,
	logger: Logger,
): Serving {
	const primary = buildPrimaryRuntime(env, db, jwks, logger);
	const app = createApp({ services: primary.services, env });

	const delivery = auditDeliveryConfig(env);
	const auditDispatcher = new AuditDispatcher({
		outbox: primary.services.audit,
		deliveryFor:
			delivery &&
			createAuditDeliveryResolver({
				config: delivery,
				issuer: primary.tenant.issuer,
				jwks,
			}),
		logger,
	});
	return {
		primary,
		app,
		auditDispatcher,
		start() {
			auditDispatcher.start();
		},
		async stop() {
			await auditDispatcher.stop();
		},
	};
}
