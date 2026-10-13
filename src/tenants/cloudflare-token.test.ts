import { describe, expect, it } from "vitest";
import { checkCloudflareToken } from "./cloudflare-token.js";

const ok = (result: unknown): Response =>
	Response.json({ success: true, result });
const refused = (): Response =>
	Response.json(
		{ success: false, errors: [{ message: "Invalid API Token" }] },
		{ status: 401 },
	);

/** Cloudflare for one zone; `routes` override answers by path suffix. */
function cloudflare(routes: Record<string, () => Response> = {}): {
	fetch: typeof fetch;
	calls: string[];
} {
	const calls: string[] = [];
	const fetchFn: typeof fetch = async (input, init) => {
		const url = String(input).replace(
			"https://api.cloudflare.com/client/v4",
			"",
		);
		calls.push(`${init?.method ?? "GET"} ${url}`);
		for (const [suffix, answer] of Object.entries(routes)) {
			if (url.endsWith(suffix)) return answer();
		}
		if (url === "/user/tokens/verify") return refused();
		if (url === "/zones?name=example.org") return ok([{ id: "zone1" }]);
		if (url === "/zones/zone1/dns_records") return ok({ id: "rec1" });
		if (url === "/zones/zone1/dns_records/rec1") return ok({});
		return Response.json({ success: false }, { status: 404 });
	};
	return { fetch: fetchFn, calls };
}

describe("checkCloudflareToken", () => {
	it("accepts an account-owned token, which /user/tokens/verify refuses", async () => {
		const api = cloudflare();
		expect(await checkCloudflareToken(api.fetch, "t", "example.org")).toBe(
			"ok",
		);
		expect(api.calls).toEqual([
			"GET /zones?name=example.org",
			"POST /zones/zone1/dns_records",
			"DELETE /zones/zone1/dns_records/rec1",
		]);
	});

	it("finds the zone of a claimed subdomain", async () => {
		const api = cloudflare();
		expect(await checkCloudflareToken(api.fetch, "t", "dev.example.org")).toBe(
			"ok",
		);
	});

	it("tells a refused token from a missing zone and from missing DNS edit", async () => {
		expect(
			await checkCloudflareToken(
				cloudflare({ "/zones?name=example.org": refused }).fetch,
				"t",
				"example.org",
			),
		).toBe("invalid");
		expect(
			await checkCloudflareToken(
				cloudflare({ "/zones?name=example.org": () => ok([]) }).fetch,
				"t",
				"example.org",
			),
		).toBe("no-zone");
		expect(
			await checkCloudflareToken(
				cloudflare({ "/zones/zone1/dns_records": refused }).fetch,
				"t",
				"example.org",
			),
		).toBe("no-dns-edit");
	});

	it("reports an unreachable Cloudflare", async () => {
		const down: typeof fetch = async () => {
			throw new TypeError("fetch failed");
		};
		expect(await checkCloudflareToken(down, "t", "example.org")).toBe(
			"unreachable",
		);
	});
});
