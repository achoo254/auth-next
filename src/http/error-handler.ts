import type { ErrorRequestHandler } from "express";
import type { Logger } from "../logger.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Last-resort handler for errors raised by Express routes (the provider
 * renders its own errors). Client errors keep their status; everything else
 * becomes a 500 without leaking details.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
	return (err: unknown, req, res, next) => {
		if (res.headersSent) {
			next(err);
			return;
		}
		const status = isRecord(err) ? err.status : undefined;
		if (
			typeof status === "number" &&
			status >= 400 &&
			status < 500 &&
			isRecord(err) &&
			err.expose === true
		) {
			res.status(status).json({ error: "invalid_request" });
			return;
		}
		logger.error(
			{ err, method: req.method, path: req.path },
			"Unhandled request error",
		);
		res.status(500).json({ error: "server_error" });
	};
}
