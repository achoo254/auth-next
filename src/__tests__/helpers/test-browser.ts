/**
 * Minimal user agent for driving the provider's browser endpoints in tests:
 * keeps cookies, follows redirects by hand and stops at a given URL prefix
 * (a client's redirect_uri) without requesting it.
 */
export class TestBrowser {
	private readonly cookies = new Map<string, string>();

	async request(
		url: string | URL,
		init: { method?: string; form?: Record<string, string> } = {},
	): Promise<Response> {
		const headers = new Headers();
		const cookie = [...this.cookies]
			.map(([name, value]) => `${name}=${value}`)
			.join("; ");
		if (cookie) headers.set("cookie", cookie);
		let body: URLSearchParams | undefined;
		if (init.form) {
			body = new URLSearchParams(init.form);
			headers.set("content-type", "application/x-www-form-urlencoded");
		}
		const response = await fetch(url, {
			method: init.method ?? (body ? "POST" : "GET"),
			headers,
			body,
			redirect: "manual",
		});
		this.storeCookies(response);
		return response;
	}

	/**
	 * Requests `url` and follows redirects. Returns the redirect target once it
	 * starts with `stopAt`, otherwise the first non-redirect response.
	 */
	async navigate(
		url: string | URL,
		init: { method?: string; form?: Record<string, string> } = {},
		stopAt?: string,
	): Promise<{ response: Response; location?: URL }> {
		let current = new URL(url);
		let response = await this.request(current, init);
		for (let hops = 0; hops < 20; hops += 1) {
			const target = response.headers.get("location");
			if (response.status < 300 || response.status >= 400 || !target) {
				return { response };
			}
			current = new URL(target, current);
			if (stopAt && current.href.startsWith(stopAt)) {
				return { response, location: current };
			}
			response = await this.request(current);
		}
		throw new Error(`Too many redirects, last at ${current.href}`);
	}

	/** Drops cookies whose name starts with `prefix` (e.g. "_session"). */
	forgetCookies(prefix: string): void {
		for (const name of [...this.cookies.keys()]) {
			if (name.startsWith(prefix)) this.cookies.delete(name);
		}
	}

	private storeCookies(response: Response): void {
		for (const header of response.headers.getSetCookie()) {
			const [pair = "", ...attributes] = header.split(";");
			const separator = pair.indexOf("=");
			const name = pair.slice(0, separator).trim();
			const value = pair.slice(separator + 1).trim();
			const expired = attributes.some((attribute) =>
				/expires=Thu, 01 Jan 1970/i.test(attribute),
			);
			if (!value || expired) this.cookies.delete(name);
			else this.cookies.set(name, value);
		}
	}
}

/** Reads a hidden form field (e.g. the xsrf token) from provider HTML. */
export function formField(html: string, name: string): string {
	const match = new RegExp(`name="${name}" value="([^"]+)"`).exec(html);
	if (!match?.[1]) throw new Error(`Form field ${name} not found`);
	return match[1];
}
