import { isIPv4 } from "node:net";

/**
 * Cloudflare's published IPv4 ranges (https://www.cloudflare.com/ips-v4).
 * A proxied record resolves into these. The `geo` block in
 * infra/nginx/tenants-http.conf lists the same ranges (a test keeps them
 * equal); update both when Cloudflare publishes a change.
 */
export const CLOUDFLARE_IPV4_RANGES: readonly string[] = [
	"173.245.48.0/20",
	"103.21.244.0/22",
	"103.22.200.0/22",
	"103.31.4.0/22",
	"141.101.64.0/18",
	"108.162.192.0/18",
	"190.93.240.0/20",
	"188.114.96.0/20",
	"197.234.240.0/22",
	"198.41.128.0/17",
	"162.158.0.0/15",
	"104.16.0.0/13",
	"104.24.0.0/14",
	"172.64.0.0/13",
	"131.0.72.0/22",
];

function toNumber(ip: string): number {
	return ip.split(".").reduce((value, octet) => value * 256 + Number(octet), 0);
}

const PARSED_RANGES = CLOUDFLARE_IPV4_RANGES.map((range) => {
	const [base = "", bits = "32"] = range.split("/");
	const size = 2 ** (32 - Number(bits));
	const start = toNumber(base);
	return { start, end: start + size };
});

/** True when `ip` is an IPv4 address inside a Cloudflare range. */
export function isCloudflareIpv4(ip: string): boolean {
	if (!isIPv4(ip)) return false;
	const value = toNumber(ip);
	return PARSED_RANGES.some(({ start, end }) => value >= start && value < end);
}
