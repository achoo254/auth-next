import type { Locale } from "./locales.js";
import { enAccountActions } from "./messages/en/account-actions.js";
import { enAccount } from "./messages/en/account.js";
import { enApps } from "./messages/en/apps.js";
import { enCommon } from "./messages/en/common.js";
import { enConsent } from "./messages/en/consent.js";
import { enGuide } from "./messages/en/guide.js";
import { enIosApp } from "./messages/en/ios-app.js";
import { enPrivacy } from "./messages/en/privacy.js";
import { enPush } from "./messages/en/push.js";
import { enSignIn } from "./messages/en/sign-in.js";
import { enTelegramBot } from "./messages/en/telegram-bot.js";
import { enTenants } from "./messages/en/tenants.js";
import { viAccountActions } from "./messages/vi/account-actions.js";
import { viAccount } from "./messages/vi/account.js";
import { viApps } from "./messages/vi/apps.js";
import { viCommon } from "./messages/vi/common.js";
import { viConsent } from "./messages/vi/consent.js";
import { viGuide } from "./messages/vi/guide.js";
import { viIosApp } from "./messages/vi/ios-app.js";
import { viPrivacy } from "./messages/vi/privacy.js";
import { viPush } from "./messages/vi/push.js";
import { viSignIn } from "./messages/vi/sign-in.js";
import { viTelegramBot } from "./messages/vi/telegram-bot.js";
import { viTenants } from "./messages/vi/tenants.js";
import { zhAccountActions } from "./messages/zh-cn/account-actions.js";
import { zhAccount } from "./messages/zh-cn/account.js";
import { zhApps } from "./messages/zh-cn/apps.js";
import { zhCommon } from "./messages/zh-cn/common.js";
import { zhConsent } from "./messages/zh-cn/consent.js";
import { zhGuide } from "./messages/zh-cn/guide.js";
import { zhIosApp } from "./messages/zh-cn/ios-app.js";
import { zhPrivacy } from "./messages/zh-cn/privacy.js";
import { zhPush } from "./messages/zh-cn/push.js";
import { zhSignIn } from "./messages/zh-cn/sign-in.js";
import { zhTelegramBot } from "./messages/zh-cn/telegram-bot.js";
import { zhTenants } from "./messages/zh-cn/tenants.js";

/** English is the source: its keys are the only valid message keys. */
const EN = {
	...enCommon,
	...enSignIn,
	...enConsent,
	...enAccount,
	...enAccountActions,
	...enPrivacy,
	...enGuide,
	...enApps,
	...enTelegramBot,
	...enTenants,
	...enPush,
	...enIosApp,
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
		...zhGuide,
		...zhApps,
		...zhTelegramBot,
		...zhTenants,
		...zhPush,
		...zhIosApp,
	},
	vi: {
		...viCommon,
		...viSignIn,
		...viConsent,
		...viAccount,
		...viAccountActions,
		...viPrivacy,
		...viGuide,
		...viApps,
		...viTelegramBot,
		...viTenants,
		...viPush,
		...viIosApp,
	},
};
