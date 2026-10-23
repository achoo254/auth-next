import { randomBytes } from "node:crypto";

/*
 * Client secrets and local origins of the primary-tenant apps (Scribe, Miu
 * World) in the test IdP: their web, mobile and development clients exist.
 */

export const SCRIBE_WEB_SECRET = randomBytes(32).toString("base64url");
export const SCRIBE_WEB_DEV_SECRET = randomBytes(32).toString("base64url");
/** A developer's local Scribe, served the scribe-web-dev client. */
export const SCRIBE_WEB_DEV_URL = "http://localhost:5174";
export const MIU_WEB_SECRET = randomBytes(32).toString("base64url");
export const MIU_WEB_DEV_SECRET = randomBytes(32).toString("base64url");
/** A developer's local Miu World (Vite proxies /api), served miu-web-dev. */
export const MIU_WEB_DEV_URL = "http://localhost:5173";

/** The environment that turns those clients on. */
export const PRIMARY_APP_TEST_ENV = {
	SCRIBE_WEB_CLIENT_SECRET: SCRIBE_WEB_SECRET,
	SCRIBE_WEB_DEV_URL,
	SCRIBE_WEB_DEV_CLIENT_SECRET: SCRIBE_WEB_DEV_SECRET,
	MIU_WEB_CLIENT_SECRET: MIU_WEB_SECRET,
	MIU_WEB_DEV_URL,
	MIU_WEB_DEV_CLIENT_SECRET: MIU_WEB_DEV_SECRET,
} as const;
