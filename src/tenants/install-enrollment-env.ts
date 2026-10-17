import type { Env } from "../config/env.js";
import type { Logger } from "../logger.js";
import {
	type InstallEnrollment,
	createInstallEnrollment,
} from "./install-enrollment.js";

/**
 * The enrollment of a self-hosted install, when ENROLLMENT_* is set (the
 * env check requires all three together): this install's primary tenant
 * is the domain the bundle was issued for.
 */
export async function installEnrollmentFrom(
	env: Env,
	logger: Logger,
): Promise<InstallEnrollment | undefined> {
	const gateway = env.ENROLLMENT_GATEWAY;
	const bundlePath = env.ENROLLMENT_BUNDLE_PATH;
	const keyPath = env.ENROLLMENT_KEY_PATH;
	if (!gateway || !bundlePath || !keyPath) return undefined;
	return createInstallEnrollment({
		gateway,
		bundlePath,
		keyPath,
		issuer: env.ISSUER,
		domain: env.TENANT_DOMAIN,
		logger,
	});
}
