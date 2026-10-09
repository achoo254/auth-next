import { type Configuration, type UnknownObject, errors } from "oidc-provider";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";

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

/** Machine name from the request, else its User-Agent, else a placeholder. */
export function deviceNameOf(
	params: UnknownObject | undefined,
	deviceInfo: UnknownObject | undefined,
): string {
	const named = stringField(params, DEVICE_NAME_PARAM);
	if (named && isValidDeviceName(named)) return named;
	const userAgent = stringField(deviceInfo, "ua");
	return userAgent ? userAgent.slice(0, 80) : "không rõ tên";
}

export function deviceIpOf(
	deviceInfo: UnknownObject | undefined,
): string | undefined {
	return stringField(deviceInfo, "ip");
}

/** Short product name shown in "Cho phép tunelo trên máy …?". */
export function deviceClientLabel(
	clientId: string,
	clientName?: string,
): string {
	return clientId === STATIC_CLIENT_IDS.tuneloCli
		? "tunelo"
		: (clientName ?? clientId);
}
