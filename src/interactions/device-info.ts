import type { Request } from "express";
import { type Configuration, type UnknownObject, errors } from "oidc-provider";
import { clientIp } from "../http/client-ip.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import type { AppServices } from "../services.js";
import type { Interaction } from "./interaction-helpers.js";

/**
 * Optional `device_name` parameter of the device authorization request:
 * the Tunelo CLI sends the machine's hostname so the approval page can ask
 * "allow tunelo on <machine>?". Printable text only, at most 64 characters.
 */
export const DEVICE_NAME_PARAM = "device_name";
const DEVICE_NAME_PATTERN = /^[\p{L}\p{N} ._'()-]{1,64}$/u;

export function isValidDeviceName(value: unknown): boolean {
	return typeof value === "string" && DEVICE_NAME_PATTERN.test(value);
}

/** `extraParams` entry: oidc-provider keeps `device_name`, rejecting bad values. */
export const DEVICE_NAME_EXTRA_PARAM: NonNullable<
	Configuration["extraParams"]
> = {
	[DEVICE_NAME_PARAM]: (_ctx: unknown, value: unknown) => {
		if (value !== undefined && !isValidDeviceName(value)) {
			throw new errors.InvalidRequest(`${DEVICE_NAME_PARAM} is invalid`);
		}
	},
};

function stringField(
	source: UnknownObject | undefined,
	key: string,
): string | undefined {
	const value = source?.[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Machine name from the request, else its User-Agent; pages name the rest. */
export function deviceNameOf(
	params: UnknownObject | undefined,
	deviceInfo: UnknownObject | undefined,
): string | undefined {
	const named = stringField(params, DEVICE_NAME_PARAM);
	if (named && isValidDeviceName(named)) return named;
	return stringField(deviceInfo, "ua")?.slice(0, 80);
}

export function deviceIpOf(
	deviceInfo: UnknownObject | undefined,
): string | undefined {
	return stringField(deviceInfo, "ip");
}

/** Short product name shown in "Allow tunelo on …?". */
export function deviceClientLabel(
	clientId: string,
	clientName?: string,
): string {
	return clientId === STATIC_CLIENT_IDS.tuneloCli
		? "tunelo"
		: (clientName ?? clientId);
}

export async function deviceCodeOf(
	services: AppServices,
	interaction: Interaction,
) {
	return interaction.deviceCode
		? services.provider.DeviceCode.find(interaction.deviceCode)
		: undefined;
}

/**
 * The machine a per-device approval is for: a device login names it in the
 * device code; a native app may pass `device_name` and is otherwise known by
 * the User-Agent of the system browser that approved it.
 */
export async function approvedDevice(
	services: AppServices,
	req: Request,
	interaction: Interaction,
): Promise<{ name?: string; ip?: string; userAgent?: string }> {
	if (!interaction.deviceCode) {
		const userAgent = req.get("user-agent") || undefined;
		return {
			name: deviceNameOf(interaction.params, { ua: userAgent }),
			ip: clientIp(req),
			userAgent,
		};
	}
	const code = await deviceCodeOf(services, interaction);
	const field = (key: string) => {
		const value = code?.deviceInfo?.[key];
		return typeof value === "string" ? value : undefined;
	};
	return {
		name: deviceNameOf(code?.params, code?.deviceInfo),
		ip: field("ip"),
		userAgent: field("ua"),
	};
}
