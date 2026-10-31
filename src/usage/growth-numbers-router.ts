import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { TenantDb } from "../tenants/tenant-data.js";
import { growthNumbers } from "./growth-numbers.js";

/** Read-only counts for Tiểu Đệ on the same server (ADR 0014). */
export const GROWTH_NUMBERS_PATH = "/internal/growth-numbers";

/** Programs on the server itself only: nginx also refuses the path from outside. */
function fromThisServer(req: Request): boolean {
	return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.ip ?? "");
}

export function createGrowthNumbersRouter(tenantDb: TenantDb): Router {
	const router = createRouter();
	router.get(GROWTH_NUMBERS_PATH, async (req: Request, res: Response, next) => {
		if (!fromThisServer(req)) {
			res.status(404).end();
			return;
		}
		try {
			res
				.set("cache-control", "no-store")
				.json(await growthNumbers(tenantDb, new Date()));
		} catch (error) {
			next(error);
		}
	});
	return router;
}
