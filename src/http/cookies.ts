import type { IncomingHttpHeaders } from "node:http";

/** Parses the Cookie header without decoding errors throwing. */
export function readCookie(
	req: { readonly headers: IncomingHttpHeaders },
	name: string,
): string | undefined {
	const header = req.headers.cookie;
	if (!header) return undefined;
	for (const part of header.split(";")) {
		const separator = part.indexOf("=");
		if (separator === -1) continue;
		if (part.slice(0, separator).trim() !== name) continue;
		const raw = part.slice(separator + 1).trim();
		try {
			return decodeURIComponent(raw);
		} catch {
			return undefined;
		}
	}
	return undefined;
}
