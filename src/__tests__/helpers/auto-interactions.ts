import type { RequestHandler } from "express";
import type Provider from "oidc-provider";

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

/**
 * TEST ONLY. Signs `accountId` in and grants every requested scope without
 * any page, standing in for the login and consent UI. Production wiring
 * never references this module; the app defaults to the 501 placeholder.
 */
export function createAutoInteractions(
	provider: Provider,
	accountId: string,
): RequestHandler {
	return (req, res, next) => {
		const complete = async (): Promise<void> => {
			const details = await provider.interactionDetails(req, res);
			const { prompt, params } = details;

			if (prompt.name === "login") {
				await provider.interactionFinished(
					req,
					res,
					{ login: { accountId } },
					{ mergeWithLastSubmission: false },
				);
				return;
			}

			if (prompt.name !== "consent" || typeof params.client_id !== "string") {
				res.status(400).send(`Unexpected prompt ${prompt.name}`);
				return;
			}

			const grant = details.grantId
				? await provider.Grant.find(details.grantId)
				: new provider.Grant({ accountId, clientId: params.client_id });
			if (!grant) throw new Error("Existing grant not found");

			const missingScope = stringArray(prompt.details.missingOIDCScope);
			if (missingScope.length > 0) grant.addOIDCScope(missingScope.join(" "));
			const missingClaims = stringArray(prompt.details.missingOIDCClaims);
			if (missingClaims.length > 0) grant.addOIDCClaims(missingClaims);
			const missingResourceScopes = prompt.details.missingResourceScopes;
			if (typeof missingResourceScopes === "object" && missingResourceScopes) {
				for (const [indicator, scopes] of Object.entries(
					missingResourceScopes,
				)) {
					grant.addResourceScope(indicator, stringArray(scopes).join(" "));
				}
			}

			const grantId = await grant.save();
			await provider.interactionFinished(
				req,
				res,
				{ consent: { grantId } },
				{ mergeWithLastSubmission: true },
			);
		};
		complete().catch(next);
	};
}
