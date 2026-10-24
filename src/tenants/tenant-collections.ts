import { GRANT_META_COLLECTION } from "../account-portal/device-grants.js";
import { SESSION_META_COLLECTION } from "../account-portal/session-directory.js";
import { ONE_TIME_TOKENS_COLLECTION } from "../accounts/one-time-tokens.js";
import { ACCOUNTS_COLLECTION } from "../accounts/user-model.js";
import { AUDIT_OUTBOX_COLLECTION } from "../audit/audit-outbox-model.js";
import { OIDC_MODEL_NAMES, collectionNameFor } from "../oidc/mongo-adapter.js";
import { PUSH_DEVICES_COLLECTION } from "../push/push-devices.js";
import { CLIENT_USAGE_COLLECTION } from "../usage/client-usage-model.js";

/** Every collection whose documents belong to one tenant (`tenantId`). */
export const TENANT_COLLECTIONS: readonly string[] = [
	ACCOUNTS_COLLECTION,
	ONE_TIME_TOKENS_COLLECTION,
	AUDIT_OUTBOX_COLLECTION,
	SESSION_META_COLLECTION,
	GRANT_META_COLLECTION,
	PUSH_DEVICES_COLLECTION,
	CLIENT_USAGE_COLLECTION,
	...OIDC_MODEL_NAMES.map(collectionNameFor),
];
