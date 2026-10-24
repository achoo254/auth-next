import { type Request, type Response, Router } from "express";
import { DOMAIN_GUIDE_PATH } from "../guide/domain-guide-link.js";
import {
	formRateLimit,
	formValue,
	parseForm,
	queryValue,
} from "../http/form.js";
import type { AppServices } from "../services.js";
import { pageContext } from "../ui/page-context.js";
import { sendPage } from "../ui/send-page.js";
import { renderAdminSignedOut } from "./admin-gate-pages.js";
import { type AdminView, renderAdminPage } from "./admin-page.js";
import {
	SETTING_RESULT_MESSAGES,
	isSettingResult,
	isSuccessResult,
} from "./admin-results.js";
import {
	addScribeAdminRoutes,
	scribeAdminView,
} from "./admin-scribe-routes.js";
import {
	type AdminSession,
	endAdminSession,
	readAdminSession,
	startAdminSession,
	takeAdminHandoff,
} from "./admin-session.js";
import type { Tenancy } from "./tenancy.js";
import { oauthClientIds, parseTelegramBot } from "./tenant-integrations.js";
import type { TenantDocument } from "./tenant-registry.js";
import {
	type SettingResult,
	removeOAuthApp,
	saveCloudflareToken,
	saveDisplayName,
	saveOAuthApp,
	saveTelegramBot,
} from "./tenant-settings.js";

export const ADMIN_PATH = "/admin";

export type AdminHandler = (
	req: Request,
	res: Response,
	context: { readonly tenant: TenantDocument; readonly session: AdminSession },
) => Promise<SettingResult>;

/**
 * /admin of a registry tenant, for its owner only. The owner arrives with a
 * one-time link from the primary tenant's /claim (their identity there
 * proved the domain), which starts a 30-minute admin session; every form
 * carries a CSRF token bound to that session. Settings are read fresh from
 * the registry on every request; secrets are never shown back.
 */
export function createAdminRouter(
	services: AppServices,
	tenancy: Tenancy,
): Router {
	const router = Router();
	const tenantId = services.tenant.id;
	const keys = services.cookieKeys;
	const limit = formRateLimit(services.formPostsPerMinute);
	const current = async (): Promise<TenantDocument | undefined> => {
		const tenant = await tenancy.registry.findById(tenantId);
		return tenant && tenant.status !== "suspended" ? tenant : undefined;
	};
	const scope = (session: AdminSession): string =>
		`tenant-admin:${tenantId}:${session.sid}`;

	router.get(`${ADMIN_PATH}/handoff`, async (req, res, next) => {
		try {
			const tenant = await current();
			const owner = await takeAdminHandoff(
				tenancy,
				services.tenant,
				queryValue(req, "token") ?? "",
			);
			const same =
				owner !== undefined &&
				tenant?.owner?.provider === owner.provider &&
				tenant.owner.providerId === owner.providerId;
			if (tenant?.owner && same)
				startAdminSession(res, services.tenant, tenant.owner, keys);
			res.redirect(303, ADMIN_PATH);
		} catch (error) {
			next(error);
		}
	});

	router.get(ADMIN_PATH, async (req, res, next) => {
		try {
			const page = pageContext(req, { fallbackPath: ADMIN_PATH });
			const tenant = await current();
			const session =
				tenant && readAdminSession(req, services.tenant, tenant.owner, keys);
			if (!tenant || !session) {
				sendPage(
					res,
					renderAdminSignedOut(page, tenancy.claimUrl, services.tenant.domain),
				);
				return;
			}
			const result = queryValue(req, "result");
			const view: AdminView = {
				page,
				csrf: services.csrf.token(req, res, scope(session)),
				tenant,
				guideUrl: new URL(DOMAIN_GUIDE_PATH, tenancy.claimUrl).href,
				oauth: await oauthClientIds(tenancy.secrets, tenantId),
				dnsConfigured: await tenancy.secrets.has(tenantId, "dns-cloudflare"),
				dnsAvailable: tenancy.provisionerPublicKey !== undefined,
				telegramUsername: parseTelegramBot(
					await tenancy.secrets.get(tenantId, "telegram"),
				)?.username,
				scribe: await scribeAdminView(tenancy, tenantId),
				result: isSettingResult(result)
					? {
							tone: isSuccessResult(result) ? "success" : "error",
							text: page.i18n.t(SETTING_RESULT_MESSAGES[result], {
								domain: tenant.domain,
							}),
						}
					: undefined,
			};
			sendPage(res, renderAdminPage(view));
		} catch (error) {
			next(error);
		}
	});

	const post = (path: string, handler: AdminHandler): void => {
		router.post(
			`${ADMIN_PATH}${path}`,
			limit,
			parseForm,
			async (req, res, next) => {
				try {
					const tenant = await current();
					const session =
						tenant &&
						readAdminSession(req, services.tenant, tenant.owner, keys);
					if (
						!tenant ||
						!session ||
						!services.csrf.verify(req, scope(session))
					) {
						res.redirect(303, ADMIN_PATH);
						return;
					}
					const result = await handler(req, res, { tenant, session });
					if (!res.headersSent)
						res.redirect(303, `${ADMIN_PATH}?result=${result}`);
				} catch (error) {
					next(error);
				}
			},
		);
	};

	post("/name", (req, _res, { tenant }) =>
		saveDisplayName(tenancy, tenant, formValue(req, "displayName") ?? ""),
	);
	post("/dns", (req, _res, { tenant }) =>
		saveCloudflareToken(tenancy, tenant, formValue(req, "token") ?? ""),
	);
	post("/telegram", (req, _res, { tenant }) =>
		saveTelegramBot(
			tenancy,
			tenant,
			formValue(req, "token") ?? "",
			formValue(req, "username") ?? "",
		),
	);
	for (const provider of ["google", "github"] as const) {
		post(`/oauth/${provider}`, (req, _res, { tenant }) =>
			saveOAuthApp(
				tenancy,
				tenant,
				provider,
				formValue(req, "clientId") ?? "",
				formValue(req, "clientSecret") ?? "",
			),
		);
		post(`/oauth/${provider}/remove`, (_req, _res, { tenant }) =>
			removeOAuthApp(tenancy, tenant, provider),
		);
	}
	addScribeAdminRoutes(post, tenancy);
	post("/sign-out", async (_req, res) => {
		endAdminSession(res, services.tenant);
		res.redirect(303, ADMIN_PATH);
		return "saved";
	});
	return router;
}
