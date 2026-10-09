/**
 * Canonical form of a request path. oidc-provider's router matches routes
 * case-insensitively and ignores a trailing slash, so anything that acts on
 * a provider endpoint before the provider (rate limits, request rewrites)
 * must treat `/TOKEN`, `/token/` and `//token` as `/token`.
 */
export function normalizeRoutePath(path: string): string {
	const collapsed = path.toLowerCase().replace(/\/{2,}/g, "/");
	const trimmed = collapsed.replace(/\/+$/, "");
	return trimmed === "" ? "/" : trimmed;
}
