import type { MessageKey } from "../i18n/dictionaries.js";

/**
 * A screenshot: of this service's own pages, one per language
 * (static/img/guide/<locale>/, `pnpm guide:screenshots`), or of another
 * service's console, shared by every language (static/img/guide/common/).
 */
export interface Figure {
	readonly image: { readonly own: string } | { readonly common: string };
	readonly caption: MessageKey;
}

export type Block =
	| { readonly paragraph: MessageKey }
	| { readonly list: readonly MessageKey[] }
	| { readonly figure: Figure };

export interface Section {
	readonly id: string;
	readonly title: MessageKey;
	readonly blocks: readonly Block[];
}

/** The steps of /guide/domain, in order: text, lists and screenshots. */
export const SECTIONS: readonly Section[] = [
	{
		id: "prepare",
		title: "guide.prepare.title",
		blocks: [
			{
				list: [
					"guide.prepare.account",
					"guide.prepare.dns",
					"guide.prepare.oauth",
					"guide.prepare.cloudflare",
				],
			},
		],
	},
	{
		id: "claim",
		title: "guide.claim.title",
		blocks: [
			{ paragraph: "guide.claim.body" },
			{
				figure: {
					image: { own: "claim-start" },
					caption: "guide.claim.figure",
				},
			},
		],
	},
	{
		id: "dns",
		title: "guide.dns.title",
		blocks: [
			{ paragraph: "guide.dns.body" },
			{
				figure: {
					image: { own: "claim-records" },
					caption: "guide.dns.figure",
				},
			},
			{
				list: [
					"guide.dns.dnsOnly",
					"guide.dns.proxied",
					"guide.dns.flexible",
					"guide.dns.wildcard",
				],
			},
			{
				figure: {
					image: { common: "cloudflare-dns-record.png" },
					caption: "guide.dns.cloudflareRecordFigure",
				},
			},
			{
				figure: {
					image: { common: "cloudflare-ssl-mode.png" },
					caption: "guide.dns.sslModeFigure",
				},
			},
			{ paragraph: "guide.dns.keepTxt" },
		],
	},
	{
		id: "verify",
		title: "guide.verify.title",
		blocks: [
			{ paragraph: "guide.verify.body" },
			{
				figure: {
					image: { own: "claim-wrong" },
					caption: "guide.verify.wrongFigure",
				},
			},
			{ paragraph: "guide.verify.done" },
			{
				figure: {
					image: { own: "claim-tenants" },
					caption: "guide.verify.doneFigure",
				},
			},
		],
	},
	{
		id: "admin",
		title: "guide.admin.title",
		blocks: [
			{ paragraph: "guide.admin.body" },
			{ paragraph: "guide.admin.deadline" },
			{
				figure: {
					image: { own: "admin-overview" },
					caption: "guide.admin.figure",
				},
			},
		],
	},
	{
		id: "sign-in",
		title: "guide.signin.title",
		blocks: [
			{ paragraph: "guide.signin.body" },
			{ paragraph: "guide.signin.github" },
			{
				figure: {
					image: { common: "github-oauth-app.jpg" },
					caption: "guide.signin.githubFigure",
				},
			},
			{ paragraph: "guide.signin.googleBranding" },
			{
				figure: {
					image: { common: "google-branding-domain.jpg" },
					caption: "guide.signin.googleBrandingFigure",
				},
			},
			{ paragraph: "guide.signin.googleClient" },
			{
				figure: {
					image: { common: "google-oauth-client.jpg" },
					caption: "guide.signin.googleClientFigure",
				},
			},
			{ paragraph: "guide.signin.paste" },
			{
				figure: {
					image: { own: "admin-oauth" },
					caption: "guide.signin.pasteFigure",
				},
			},
		],
	},
	{
		id: "cloudflare-token",
		title: "guide.token.title",
		blocks: [
			{ paragraph: "guide.token.body" },
			{
				figure: {
					image: { common: "cloudflare-token-template.png" },
					caption: "guide.token.templateFigure",
				},
			},
			{
				figure: {
					image: { common: "cloudflare-token-create.png" },
					caption: "guide.token.createFigure",
				},
			},
			{
				figure: { image: { own: "admin-dns" }, caption: "guide.token.figure" },
			},
			{ paragraph: "guide.token.without" },
		],
	},
	{
		id: "users",
		title: "guide.users.title",
		blocks: [
			{
				list: [
					"guide.users.accounts",
					"guide.users.chat",
					"guide.users.localman",
					"guide.users.tunelo",
				],
			},
		],
	},
	{
		id: "keep",
		title: "guide.keep.title",
		blocks: [{ paragraph: "guide.keep.body" }],
	},
];
