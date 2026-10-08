import { isIPv6 } from "node:net";
import type { Request } from "express";

/** The client address Express derived through the trusted proxies. */
export function clientIp(req: Request): string {
	return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/** Expands an IPv6 address to its 8 hextets (no zone, no embedded IPv4). */
function hextets(address: string): string[] | undefined {
	const [head = "", tail] = address.split("::");
	const left = head ? head.split(":") : [];
	const right = tail ? tail.split(":") : [];
	if (tail === undefined && left.length !== 8) return undefined;
	const zeros = Array.from(
		{ length: 8 - left.length - right.length },
		() => "0",
	);
	const all = [...left, ...zeros, ...right];
	return all.length === 8 ? all.map((part) => part.toLowerCase()) : undefined;
}

/**
 * The key a client IP is throttled under. IPv4 as is (also when written as
 * ::ffff:a.b.c.d); IPv6 grouped to its /64, since one host usually owns a
 * whole /64 and could otherwise rotate addresses to dodge the budget.
 */
export function ipThrottleKey(ip: string): string {
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
	if (mapped?.[1]) return mapped[1];
	const address = ip.split("%")[0] ?? ip;
	if (!isIPv6(address) || address.includes(".")) return ip;
	const parts = hextets(address);
	return parts ? `${parts.slice(0, 4).join(":")}::/64` : ip;
}
