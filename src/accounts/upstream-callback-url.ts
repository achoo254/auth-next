/** The registered redirect URI with the query the provider sent back. */
export function callbackUrl(redirectUri: string, query: URLSearchParams): URL {
	const url = new URL(redirectUri);
	url.search = query.toString();
	return url;
}
