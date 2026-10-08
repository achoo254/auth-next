import express, { type Request, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";

/**
 * Body parser for the server-rendered forms only. It must never run in
 * front of oidc-provider, which parses its own request bodies.
 */
export const parseForm: RequestHandler = express.urlencoded({
	extended: false,
	limit: "16kb",
	parameterLimit: 50,
});

/**
 * Per-IP budget for the form POSTs of the server-rendered pages (on top of
 * the per-account lockout). These routes run after forwardTrustedClientInfo,
 * which already replaced X-Forwarded-For with the trusted client IP.
 */
export function formRateLimit(
	limit: number,
	windowMs = 60_000,
): RequestHandler {
	return rateLimit({
		windowMs,
		limit,
		standardHeaders: "draft-8",
		legacyHeaders: false,
		message: "Quá nhiều yêu cầu. Thử lại sau ít phút.",
		validate: { xForwardedForHeader: false },
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** A single string field from a parsed form; repeated or missing → undefined. */
export function formValue(req: Request, name: string): string | undefined {
	const body: unknown = req.body;
	if (!isRecord(body)) return undefined;
	const value = body[name];
	return typeof value === "string" ? value : undefined;
}

/** Trimmed field value, or "" when absent. */
export function formText(req: Request, name: string, maxLength = 512): string {
	return (formValue(req, name) ?? "").trim().slice(0, maxLength);
}

/** A route parameter as a string (Express 5 types it loosely). */
export function routeParam(req: Request, name: string): string {
	const value: unknown = req.params[name];
	return typeof value === "string" ? value : "";
}

/** A single query parameter as a string. */
export function queryValue(req: Request, name: string): string | undefined {
	const value: unknown = req.query[name];
	return typeof value === "string" ? value : undefined;
}

/** Parses the Cookie header without decoding errors throwing. */
export function readCookie(req: Request, name: string): string | undefined {
	const header = req.headers.cookie;
	if (!header) return undefined;
	for (const part of header.split(";")) {
		const separator = part.indexOf("=");
		if (separator === -1) continue;
		if (part.slice(0, separator).trim() !== name) continue;
		const raw = part.slice(separator + 1).trim();
		try {
			return decodeURIComponent(raw);
		} catch {
			return undefined;
		}
	}
	return undefined;
}
