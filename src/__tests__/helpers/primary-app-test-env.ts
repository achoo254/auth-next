import { randomBytes } from "node:crypto";

/*
 * Client secrets and local origins of the primary-tenant apps (Scribe, Miu
 * World, Tiểu Đệ, Tử Vi, Clip) in the test IdP: all their clients exist.
 */

export const SCRIBE_WEB_SECRET = randomBytes(32).toString("base64url");
export const SCRIBE_WEB_DEV_SECRET = randomBytes(32).toString("base64url");
/** A developer's local Scribe, served the scribe-web-dev client. */
export const SCRIBE_WEB_DEV_URL = "http://localhost:5174";
export const MIU_WEB_SECRET = randomBytes(32).toString("base64url");
export const MIU_WEB_DEV_SECRET = randomBytes(32).toString("base64url");
/** A developer's local Miu World (Vite proxies /api), served miu-web-dev. */
export const MIU_WEB_DEV_URL = "http://localhost:5173";

export const TIEUDE_WEB_SECRET = randomBytes(32).toString("base64url");
export const TIEUDE_WEB_URL = "https://tieude.hoandat.com";
export const TUVI_WEB_SECRET = randomBytes(32).toString("base64url");
export const TUVI_WEB_URL = "https://tuvi.hoandat.com";
export const CLIP_WEB_SECRET = randomBytes(32).toString("base64url");
export const CLIP_WEB_URL = "https://clip.hoandat.com";

/** The environment that turns those clients on. */
export const PRIMARY_APP_TEST_ENV = {
	TIEUDE_WEB_URL,
	TIEUDE_WEB_CLIENT_SECRET: TIEUDE_WEB_SECRET,
	TUVI_WEB_URL,
	TUVI_WEB_CLIENT_SECRET: TUVI_WEB_SECRET,
	CLIP_WEB_URL,
	CLIP_WEB_CLIENT_SECRET: CLIP_WEB_SECRET,
	SCRIBE_WEB_CLIENT_SECRET: SCRIBE_WEB_SECRET,
	SCRIBE_WEB_DEV_URL,
	SCRIBE_WEB_DEV_CLIENT_SECRET: SCRIBE_WEB_DEV_SECRET,
	MIU_WEB_CLIENT_SECRET: MIU_WEB_SECRET,
	MIU_WEB_DEV_URL,
	MIU_WEB_DEV_CLIENT_SECRET: MIU_WEB_DEV_SECRET,
} as const;
