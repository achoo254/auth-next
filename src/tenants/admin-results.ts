import type { MessageKey } from "../i18n/dictionaries.js";
import type { SettingResult } from "./tenant-settings.js";

/** The message /admin shows after saving a setting. */
export const SETTING_RESULT_MESSAGES: Readonly<
	Record<SettingResult, MessageKey>
> = {
	saved: "admin.result.saved",
	invalid: "admin.result.invalid",
	"last-provider": "admin.result.lastProvider",
	"cloudflare-invalid": "admin.result.cloudflareInvalid",
	"cloudflare-no-zone": "admin.result.cloudflareNoZone",
	"cloudflare-no-dns-edit": "admin.result.cloudflareNoDnsEdit",
	"cloudflare-unreachable": "admin.result.cloudflareUnreachable",
	"dns-unavailable": "admin.result.dnsUnavailable",
	"telegram-refused": "admin.result.telegramRefused",
};

export function isSettingResult(
	value: string | undefined,
): value is SettingResult {
	return value !== undefined && Object.hasOwn(SETTING_RESULT_MESSAGES, value);
}
