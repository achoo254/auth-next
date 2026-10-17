/**
 * The gateway's side of GHCR for the self-hosted release images (ADR 0007):
 * a pull token per image from GHCR's token endpoint, with the classic
 * token RELEASE_REGISTRY_TOKEN, cached until shortly before it expires.
 */

/** The images a self-hosted install pulls; nothing else is served. */
export const RELEASE_IMAGES: ReadonlySet<string> = new Set([
	"selfhosted-auth",
	"selfhosted-localman",
	"selfhosted-tunelo",
	"selfhosted-chat",
	"selfhosted-nginx",
	"selfhosted-bundle",
]);

const GHCR = "https://ghcr.io";
/** GHCR's pull tokens live five minutes; keep them four. */
const TOKEN_TTL_MS = 4 * 60 * 1000;

export interface ReleaseUpstreamConfig {
	readonly owner: string;
	readonly token: string;
	readonly fetch: typeof fetch;
}

export interface ReleaseUpstream {
	/**
	 * A request to GHCR for `image` (`path` after `/v2/<owner>/<image>/`),
	 * redirects not followed: blob downloads answer with a signed CDN URL.
	 */
	request(
		image: string,
		path: string,
		init: { readonly method: "GET" | "HEAD"; readonly accept?: string },
	): Promise<Response>;
}

export function createReleaseUpstream(
	config: ReleaseUpstreamConfig,
): ReleaseUpstream {
	const tokens = new Map<string, { value: string; expiresAt: number }>();
	const basic = Buffer.from(`${config.owner}:${config.token}`).toString(
		"base64",
	);

	async function pullToken(image: string): Promise<string> {
		const cached = tokens.get(image);
		if (cached && cached.expiresAt > Date.now()) return cached.value;
		const scope = `repository:${config.owner}/${image}:pull`;
		const response = await config.fetch(
			`${GHCR}/token?service=ghcr.io&scope=${encodeURIComponent(scope)}`,
			{ headers: { authorization: `Basic ${basic}` } },
		);
		const body: unknown = response.ok ? await response.json() : undefined;
		const value =
			typeof body === "object" && body !== null
				? Reflect.get(body, "token")
				: undefined;
		if (typeof value !== "string") {
			throw new Error(`GHCR refused a pull token (${response.status})`);
		}
		tokens.set(image, { value, expiresAt: Date.now() + TOKEN_TTL_MS });
		return value;
	}

	return {
		async request(image, path, init) {
			const token = await pullToken(image);
			return config.fetch(`${GHCR}/v2/${config.owner}/${image}/${path}`, {
				method: init.method,
				redirect: "manual",
				headers: {
					authorization: `Bearer ${token}`,
					...(init.accept ? { accept: init.accept } : {}),
				},
			});
		},
	};
}
