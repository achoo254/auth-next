/** A unit of certificate work from the IdP's internal API, and its result. */
export interface WorkItem {
	readonly tenantId: string;
	readonly domain: unknown;
	readonly action: "issue" | "remove";
	readonly dnsCredential: unknown;
}

export type Outcome =
	| { readonly outcome: "issued" | "removed" }
	| {
			readonly outcome: "failed";
			readonly error: string;
	  };

export function parseWork(body: unknown): WorkItem[] {
	const work =
		typeof body === "object" && body !== null
			? Reflect.get(body, "work")
			: undefined;
	if (!Array.isArray(work)) return [];
	return work.flatMap((item: unknown) => {
		if (typeof item !== "object" || item === null) return [];
		const tenantId = Reflect.get(item, "tenantId");
		const action = Reflect.get(item, "action");
		if (typeof tenantId !== "string" || !/^ten_[\w-]+$/.test(tenantId))
			return [];
		if (action !== "issue" && action !== "remove") return [];
		return [
			{
				tenantId,
				action,
				domain: Reflect.get(item, "domain"),
				dnsCredential: Reflect.get(item, "dnsCredential"),
			},
		];
	});
}
