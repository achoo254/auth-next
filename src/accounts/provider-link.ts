import {
	type ProviderDetail,
	type UpstreamProvider,
	normalizeEmail,
} from "./user-model.js";

/** A provider account being linked, as the provider described it. */
export interface ProviderLink {
	readonly provider: UpstreamProvider;
	readonly providerId: string;
	readonly verifiedEmail?: string;
	/** GitHub login. */
	readonly login?: string;
	/** Apple refresh token, kept to revoke the authorization later. */
	readonly revocationToken?: string;
}

/** What is stored about a link, shown on /account. */
export function providerDetail(link: ProviderLink): ProviderDetail {
	const detail: ProviderDetail = { linkedAt: new Date() };
	if (link.verifiedEmail) detail.email = normalizeEmail(link.verifiedEmail);
	if (link.login) detail.login = link.login;
	if (link.revocationToken) detail.revocationToken = link.revocationToken;
	return detail;
}
