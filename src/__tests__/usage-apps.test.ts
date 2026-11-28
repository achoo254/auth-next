import { describe, expect, it } from "vitest";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { appCount, appOfClient } from "../usage/usage-apps.js";

describe("appOfClient", () => {
	it("keeps past usage of retired apps with those apps, not with Localman", () => {
		expect(appOfClient("miu-web")).toBe("miu");
		expect(appOfClient("miu-mobile")).toBe("miu");
		expect(appOfClient("miu-web-dev")).toBe("miu");
		expect(appOfClient("truyen-web")).toBe("truyen");
		expect(appOfClient("lockin-web")).toBe("lockin");
	});

	it("still counts any other unknown client as a Localman MCP client", () => {
		expect(appOfClient("dcr-registered-client")).toBe("localman");
	});

	it("counts a retired app and Localman as two apps", () => {
		expect(
			appCount(["miu-web", STATIC_CLIENT_IDS.localmanWeb, "miu-mobile"]),
		).toBe(2);
	});
});
