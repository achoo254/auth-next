import { brand } from "../../../brand.js";

/** Shared words, the page shell, error pages. English is the source. */
export const enCommon = {
	"common.unknown": "unknown",
	"common.back": "Back",
	"common.backToAccount": "Back to your account",
	"common.cancel": "Cancel",
	"common.continue": "Continue",
	"common.tryAgain": "Try again",
	"common.signedInAs": "Signed in as {username}.",
	"common.tooManyRequests": "Too many requests. Try again in a few minutes.",
	"layout.brand": "Account",
	/** Meta description of every page; the English text is the brand description. */
	"layout.description": brand.description,
	"layout.language": "Language",
	"layout.nav": "Site",
	"layout.ecosystem": "An app from {brandDomain}",
	"layout.home": "Home",
	"client.external": "External app",
	"client.quoted": "“{name}”",
	"client.externalNamed": "{name} (external app)",
	"error.title": "Can't continue",
	"error.code": "Error code: {code}",
	"error.unsupportedStep": "This sign-in step isn't supported yet.",
	"error.interactionExpired":
		"This sign-in has expired or is no longer valid. Go back to the app and sign in again.",
	"error.otherInteraction":
		"This page belongs to a different sign-in. Go back to the app and sign in again.",
	"error.formExpired": "This form has expired. Reload the page and try again.",
	"error.consentMissing":
		"The account or app of this sign-in wasn't found. Go back to the app and sign in again.",
	"providerError.invalidRequest":
		"The sign-in request is invalid or has expired. Go back to the app and try again.",
	"providerError.invalidClient": "The app asking you to sign in isn't valid.",
	"providerError.invalidRedirectUri": "The app's return address isn't valid.",
	"providerError.unauthorizedClient":
		"The app isn't allowed to use this way of signing in.",
	"providerError.accessDenied": "The request was denied.",
	"providerError.invalidScope":
		"The app asked for a permission that isn't supported.",
	"providerError.invalidTarget":
		"The app asked for access to a service it isn't allowed to use.",
	"providerError.loginRequired": "You need to sign in to continue.",
	"providerError.serverError":
		"Something went wrong on the server. Try again in a few minutes.",
	"providerError.unknown":
		"The request couldn't be processed. Try again in a few minutes.",
};
