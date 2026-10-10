import type { Request } from "express";

/** The client address Express derived through the trusted proxies. */
export function clientIp(req: Request): string {
	return req.ip ?? req.socket.remoteAddress ?? "unknown";
}
