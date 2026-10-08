import type { Configuration } from "oidc-provider";

/**
 * Over https every cookie is Secure. The session cookie lives on "/" and
 * takes the `__Host-` prefix; interaction cookies are scoped to their
 * interaction path, which `__Host-` forbids, so they use `__Secure-`.
 */
export function cookieConfig(
	issuer: string,
	keys: readonly string[],
): NonNullable<Configuration["cookies"]> {
	const secure = new URL(issuer).protocol === "https:";
	const options = { httpOnly: true, sameSite: "lax", secure } as const;
	return {
		keys: [...keys],
		long: options,
		short: options,
		names: secure
			? {
					session: "__Host-session",
					interaction: "__Secure-interaction",
					resume: "__Secure-interaction_resume",
				}
			: {
					session: "_session",
					interaction: "_interaction",
					resume: "_interaction_resume",
				},
	};
}
