import type { IncomingHttpHeaders } from "node:http";

/**
 * Every value of a cookie in the Cookie header, in header order, without
 * decoding errors throwing (an undecodable value is skipped). Browsers
 * send one value per (name, domain, path), so a host-only and a domain
 * cookie of the same name both arrive.
 */
export function readCookies(
	req: { readonly headers: IncomingHttpHeaders },
	name: string,
): string[] {
	const header = req.headers.cookie;
	if (!header) return [];
	const values: string[] = [];
	for (const part of header.split(";")) {
		const separator = part.indexOf("=");
		if (separator === -1) continue;
		if (part.slice(0, separator).trim() !== name) continue;
		try {
			values.push(decodeURIComponent(part.slice(separator + 1).trim()));
		} catch {
			// Not percent-encoded text: not a value this app wrote.
		}
	}
	return values;
}

/** The first value of a cookie in the Cookie header. */
export function readCookie(
	req: { readonly headers: IncomingHttpHeaders },
	name: string,
): string | undefined {
	return readCookies(req, name)[0];
}
