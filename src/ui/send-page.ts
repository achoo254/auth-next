import type { Response } from "express";

/** Sends a rendered page; pages carry tokens or account data, so no caching. */
export function sendPage(res: Response, page: string, status = 200): void {
	res.status(status).set("cache-control", "no-store").type("html").send(page);
}
