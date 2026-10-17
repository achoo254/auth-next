import { BlockList, isIP } from "node:net";

/**
 * Addresses a request to a tenant-controlled host must never reach: the
 * gateway resolves `auth.<domain>` of a domain someone else controls, so
 * DNS could name this machine's loopback API or the private network.
 */
const NON_PUBLIC_V4 = new BlockList();
for (const [network, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 3],
] as const) {
	NON_PUBLIC_V4.addSubnet(network, prefix, "ipv4");
}
/*
 * A list of its own: one BlockList matches IPv4 addresses against
 * IPv4-mapped IPv6 rules too, so ::ffff:0:0/96 would block every IPv4.
 */
const NON_PUBLIC_V6 = new BlockList();
for (const [network, prefix] of [
	["::", 128],
	["::1", 128],
	["::ffff:0:0", 96],
	["64:ff9b::", 96],
	["100::", 64],
	["2001:db8::", 32],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
] as const) {
	NON_PUBLIC_V6.addSubnet(network, prefix, "ipv6");
}

/** True for a unicast address on the public internet. */
export function isPublicAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 0) return false;
	return family === 4
		? !NON_PUBLIC_V4.check(address, "ipv4")
		: !NON_PUBLIC_V6.check(address, "ipv6");
}
