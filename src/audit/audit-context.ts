import type { Request } from "express";
import { clientIp } from "../http/client-ip.js";
import type { AuditContext } from "./audit-events.js";

const MAX_USER_AGENT_LENGTH = 256;
const MAX_LABEL_LENGTH = 64;

/** Text from the client without control characters, trimmed and capped. */
function cleanText(value: string | undefined, max: number): string | undefined {
	const text = value?.replace(/\p{C}/gu, "").trim().slice(0, max);
	return text || undefined;
}

/** A user-supplied name (e.g. a device name), safe to store in an event. */
export function auditLabel(value: string | undefined): string | undefined {
	return cleanText(value, MAX_LABEL_LENGTH);
}

/** Client IP (as derived from trusted proxies) and User-Agent of `req`. */
export function auditContext(req: Request): AuditContext {
	const userAgent = cleanText(req.get("user-agent"), MAX_USER_AGENT_LENGTH);
	return { ip: clientIp(req), ...(userAgent ? { userAgent } : {}) };
}
