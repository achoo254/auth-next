import { z } from "zod";

/**
 * Recording which app each sign-in goes to (`client_usage`, ADR 0011).
 * On by default; `CLIENT_USAGE_ENABLED=false` (then a restart) stops new
 * records without a code change. What is stored stays until its TTL.
 */
export const usageEnvShape = {
	CLIENT_USAGE_ENABLED: z
		.enum(["true", "false"], { error: "must be true or false" })
		.default("true")
		.transform((value) => value === "true"),
};
