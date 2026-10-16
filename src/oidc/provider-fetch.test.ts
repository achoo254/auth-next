import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { providerFetch } from "./provider.js";

let server: Server | undefined;

afterEach(async () => {
	await new Promise<void>(
		(resolve) => server?.close(() => resolve()) ?? resolve(),
	);
	server = undefined;
});

describe("providerFetch", () => {
	it("outlasts oidc-provider's 2.5 s signal for a slow app", async () => {
		server = createServer((_req, res) => {
			setTimeout(() => res.end("ok"), 3_000);
		}).listen(0);
		const { port } = server.address() as AddressInfo;
		// What oidc-provider passes in before each call.
		const res = await providerFetch(`http://127.0.0.1:${port}/`, {
			method: "POST",
			signal: AbortSignal.timeout(2_500),
		});
		expect(await res.text()).toBe("ok");
	}, 10_000);
});
