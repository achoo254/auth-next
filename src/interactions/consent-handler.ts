import type { Request, Response } from "express";
import {
	grantsPerDevice,
	recordDeviceGrant,
} from "../account-portal/device-grants.js";
import { auditContext, auditLabel } from "../audit/audit-context.js";
import { clientIp } from "../http/client-ip.js";
import { isStaticClientId } from "../oidc/clients.js";
import { imitatesFirstPartyName } from "../oidc/first-party-name.js";
import { isLoopbackHostname } from "../oidc/registration-policy.js";
import { GRANT_IDLE_SECONDS } from "../oidc/sliding-grants.js";
import { notifyAccount } from "../push/notify-account.js";
import type { AppServices } from "../services.js";
import { sendPage } from "../ui/send-page.js";
import { renderConsent } from "./consent-page.js";
import { approvedDevice, deviceCodeOf } from "./device-info.js";
import { renderDeviceApproval } from "./device-verify-page.js";
import { requestedScopes, saveConsentGrant } from "./grant-builder.js";
import {
	type Interaction,
	csrfScope,
	interactionClientId,
	interactionPage,
	sendInteractionError,
} from "./interaction-helpers.js";

/**
 * The redirect_uri this authorization request returns to; a client with a
 * single registered redirect URI may leave the parameter out.
 */
function redirectUriOf(
	interaction: Interaction,
	registered: readonly string[] | undefined,
): URL | undefined {
	const requested = interaction.params.redirect_uri;
	const uri =
		typeof requested === "string"
			? requested
			: registered?.length === 1
				? registered[0]
				: undefined;
	return uri ? (URL.parse(uri) ?? undefined) : undefined;
}

/**
 * Grants consent and resumes. Per-device approvals (device logins, native
 * apps) get their own grant and the machine name is remembered for the
 * account page.
 */
export async function completeConsent(
	services: AppServices,
	req: Request,
	res: Response,
	interaction: Interaction,
	accountId: string,
): Promise<void> {
	const clientId = interactionClientId(interaction);
	const isDevice =
		interaction.deviceCode !== undefined || grantsPerDevice(clientId);
	let deviceName: string | undefined;
	const grantId = await saveConsentGrant(
		services.provider,
		interaction,
		accountId,
		isDevice,
	);
	if (isDevice) {
		const device = await approvedDevice(services, req, interaction);
		deviceName = device.name;
		await recordDeviceGrant(
			services,
			{
				_id: grantId,
				accountId,
				...(deviceName ? { deviceName } : {}),
				ip: device.ip,
				userAgent: device.userAgent,
			},
			// Device grants slide on every refresh; the metadata slides with them.
			GRANT_IDLE_SECONDS,
		);
		services.logger.info(
			{ accountId, clientId, ip: clientIp(req) },
			"Device approved",
		);
		notifyAccount(
			services,
			await services.accounts.findActiveById(accountId),
			{ kind: "new-sign-in" },
			{ exceptGrantId: grantId },
		);
	}
	await services.provider.interactionFinished(
		req,
		res,
		{ consent: { grantId } },
		{ mergeWithLastSubmission: true },
	);
	// First-party web apps consent silently; only devices and third-party
	// (DCR) apps are a new grant of access the owner chose to give.
	if (isDevice || !isStaticClientId(clientId)) {
		await services.audit.record(
			"grant.created",
			accountId,
			isDevice
				? { clientId, kind: "device", deviceName: auditLabel(deviceName) }
				: { clientId, kind: "third-party-app" },
			auditContext(req),
		);
	}
}

/**
 * The consent step. First-party web apps are consented silently (they are
 * ours); device logins get the "allow tunelo on <machine>?" page; any other
 * client, i.e. one registered through DCR, gets the consent page.
 */
export async function showConsent(
	services: AppServices,
	req: Request,
	res: Response,
	interaction: Interaction,
): Promise<void> {
	const accountId = interaction.session?.accountId;
	const account = accountId
		? await services.accounts.findActiveById(accountId)
		: undefined;
	const clientId = interactionClientId(interaction);
	const client = await services.provider.Client.find(clientId);
	if (!account || !client) {
		sendInteractionError(services, res, { message: "error.consentMissing" });
		return;
	}
	const csrf = services.csrf.token(req, res, csrfScope(interaction.uid));
	const page = interactionPage(req, interaction);
	if (interaction.deviceCode) {
		const code = await deviceCodeOf(services, interaction);
		sendPage(
			res,
			renderDeviceApproval({
				host: services.host,
				page,
				csrf,
				uid: interaction.uid,
				clientId,
				clientName: client.clientName,
				params: code?.params,
				deviceInfo: code?.deviceInfo,
				userCode: code?.userCode,
				scopes: requestedScopes(interaction),
				username: account.username,
			}),
		);
		return;
	}
	if (isStaticClientId(clientId) && client.applicationType !== "native") {
		await completeConsent(services, req, res, interaction, account._id);
		return;
	}
	const clientName = client.clientName ?? clientId;
	const external = !isStaticClientId(clientId);
	const redirect = redirectUriOf(interaction, client.redirectUris);
	// A loopback redirect hands the code only to the machine of whoever clicks
	// Allow, so a lookalike name there cannot phish; elsewhere it can.
	const loopback = redirect ? isLoopbackHostname(redirect.hostname) : false;
	sendPage(
		res,
		renderConsent({
			host: services.host,
			page,
			csrf,
			uid: interaction.uid,
			clientName,
			external,
			imitatesFirstParty:
				external &&
				!loopback &&
				imitatesFirstPartyName(clientName, services.tenant.displayName),
			redirectHost: redirect?.host,
			scopes: requestedScopes(interaction),
			username: account.username,
		}),
	);
}
