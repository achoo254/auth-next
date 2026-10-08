import { isIP } from "node:net";

/**
 * Published Cloudflare edge ranges (https://www.cloudflare.com/ips/, fetched
 * 2026-10-08). Review them when Cloudflare announces changes.
 */
export const CLOUDFLARE_IP_RANGES: readonly string[] = [
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
	"2400:cb00::/32",
	"2606:4700::/32",
	"2803:f800::/32",
	"2405:b500::/32",
	"2405:8100::/32",
	"2a06:98c0::/29",
	"2c0f:f248::/32",
];

/** Names understood by Express (proxy-addr) for well-known private ranges. */
const NAMED_RANGES = new Set(["loopback", "linklocal", "uniquelocal"]);

/**
 * Addresses whose X-Forwarded-* headers are believed, in the form accepted by
 * Express' "trust proxy" setting, or `false` to believe none.
 */
export type TrustProxy = false | readonly string[];

function isValidCidr(value: string): boolean {
	const [address, prefix, ...rest] = value.split("/");
	if (rest.length > 0 || address === undefined || prefix === undefined) {
		return false;
	}
	const family = isIP(address);
	if (family === 0 || !/^\d{1,3}$/.test(prefix)) return false;
	return Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * Parses TRUST_PROXY: a comma-separated list of `loopback`, `linklocal`,
 * `uniquelocal`, `cloudflare`, IP addresses or CIDR ranges; `false` or
 * `none` trusts no proxy. Hop counts and `true` are rejected on purpose:
 * they would let any client spoof its address through X-Forwarded-For.
 */
export function parseTrustProxy(raw: string): TrustProxy {
	const tokens = raw
		.split(",")
		.map((token) => token.trim().toLowerCase())
		.filter((token) => token.length > 0);
	if (tokens.length === 0) {
		throw new Error("must list at least one proxy or be 'false'");
	}
	if (tokens.length === 1 && (tokens[0] === "false" || tokens[0] === "none")) {
		return false;
	}
	const trusted: string[] = [];
	for (const token of tokens) {
		if (token === "cloudflare") {
			trusted.push(...CLOUDFLARE_IP_RANGES);
		} else if (NAMED_RANGES.has(token) || isIP(token) !== 0) {
			trusted.push(token);
		} else if (isValidCidr(token)) {
			trusted.push(token);
		} else {
			throw new Error(
				`unsupported entry "${token}"; use loopback, linklocal, uniquelocal, cloudflare, an IP or a CIDR range`,
			);
		}
	}
	return trusted;
}
