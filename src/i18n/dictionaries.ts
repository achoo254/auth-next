import type { Locale } from "./locales.js";
import { enAccountActions } from "./messages/en/account-actions.js";
import { enAccount } from "./messages/en/account.js";
import { enCommon } from "./messages/en/common.js";
import { enConsent } from "./messages/en/consent.js";
import { enPrivacy } from "./messages/en/privacy.js";
import { enSignIn } from "./messages/en/sign-in.js";
import { enTelegramBot } from "./messages/en/telegram-bot.js";
import { viAccountActions } from "./messages/vi/account-actions.js";
import { viAccount } from "./messages/vi/account.js";
import { viCommon } from "./messages/vi/common.js";
import { viConsent } from "./messages/vi/consent.js";
import { viPrivacy } from "./messages/vi/privacy.js";
import { viSignIn } from "./messages/vi/sign-in.js";
import { viTelegramBot } from "./messages/vi/telegram-bot.js";
import { zhAccountActions } from "./messages/zh-cn/account-actions.js";
import { zhAccount } from "./messages/zh-cn/account.js";
import { zhCommon } from "./messages/zh-cn/common.js";
import { zhConsent } from "./messages/zh-cn/consent.js";
import { zhPrivacy } from "./messages/zh-cn/privacy.js";
import { zhSignIn } from "./messages/zh-cn/sign-in.js";
import { zhTelegramBot } from "./messages/zh-cn/telegram-bot.js";

/** English is the source: its keys are the only valid message keys. */
const EN = {
	...enCommon,
	...enSignIn,
	...enConsent,
	...enAccount,
	...enAccountActions,
	...enPrivacy,
	...enTelegramBot,
};

export type MessageKey = keyof typeof EN;

export type Messages = { readonly [K in MessageKey]: string };

/**
 * Every page and Telegram bot string in every language; a missing key
 * fails the typecheck.
 */
export const DICTIONARIES: Readonly<Record<Locale, Messages>> = {
	en: EN,
	"zh-CN": {
		...zhCommon,
		...zhSignIn,
		...zhConsent,
		...zhAccount,
		...zhAccountActions,
		...zhPrivacy,
		...zhTelegramBot,
	},
	vi: {
		...viCommon,
		...viSignIn,
		...viConsent,
		...viAccount,
		...viAccountActions,
		...viPrivacy,
		...viTelegramBot,
	},
};
