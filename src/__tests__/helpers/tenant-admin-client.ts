import { issueAdminHandoff } from "../../tenants/admin-session.js";
import type { Tenancy } from "../../tenants/tenancy.js";
import type { TenantDocument } from "../../tenants/tenant-registry.js";
import { type MultiTenantServer, fetchAs } from "./multi-tenant-server.js";
import { formField } from "./test-browser.js";

/** A browser-like client of one tenant host: keeps cookies, sends Host. */
export class HostClient {
	private readonly cookies = new Map<string, string>();
	constructor(
		private readonly server: MultiTenantServer,
		private readonly host: string,
	) {}

	async request(
		path: string,
		form?: Record<string, string>,
	): Promise<Response> {
		const response = await fetchAs(this.server.origin, this.host, path, {
			method: form ? "POST" : "GET",
			headers: {
				cookie: [...this.cookies]
					.map(([name, value]) => `${name}=${value}`)
					.join("; "),
				...(form
					? { "content-type": "application/x-www-form-urlencoded" }
					: {}),
			},
			body: form ? new URLSearchParams(form).toString() : undefined,
		});
		for (const header of response.headers.getSetCookie()) {
			const [pair = ""] = header.split(";");
			const index = pair.indexOf("=");
			this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
		}
		return response;
	}
}

/** The owner's client at a tenant's /admin, signed in through a handoff link. */
export async function signedInAdmin(
	server: MultiTenantServer,
	tenant: TenantDocument,
): Promise<{
	readonly client: HostClient;
	/** The /admin page and the CSRF token of its forms. */
	page(): Promise<{ readonly html: string; readonly csrf: string }>;
}> {
	const owner = tenant.owner;
	if (!owner) throw new Error("tenant has no owner");
	// The handoff only needs the database (a token in the tenant's store).
	const tenancy = { db: server.db } as unknown as Tenancy;
	const link = new URL(await issueAdminHandoff(tenancy, tenant, owner));
	const client = new HostClient(server, link.host);
	await client.request(`${link.pathname}${link.search}`);
	return {
		client,
		async page() {
			const html = await (await client.request("/admin")).text();
			return { html, csrf: formField(html, "csrf") };
		},
	};
}
