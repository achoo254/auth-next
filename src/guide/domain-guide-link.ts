import type { IncomingMessage } from "node:http";
import type { RequestHandler } from "express";

export const DOMAIN_GUIDE_PATH = "/guide/domain";

/** Requests served by an app that mounts the domain guide. */
const offering = new WeakSet<IncomingMessage>();

/**
 * Marks every request through this handler as served where the domain
 * guide exists (the primary tenant with tenancy), so the topbar links it.
 */
export const offerDomainGuide: RequestHandler = (req, _res, next) => {
	offering.add(req);
	next();
};

export function offersDomainGuide(req: IncomingMessage): boolean {
	return offering.has(req);
}
