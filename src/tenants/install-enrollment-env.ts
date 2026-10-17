import { access, writeFile } from "node:fs/promises";
import type { Env } from "../config/env.js";
import type { Logger } from "../logger.js";
import {
	type InstallEnrollment,
	createInstallEnrollment,
} from "./install-enrollment.js";

/**
 * Written next to the install's key once the gateway confirmed it: later
 * starts skip enrollment entirely, so the bundle may expire and the
 * gateway is out of every path, start-up included (ADR 0007).
 */
export function enrolledMarkerPath(keyPath: string): string {
	return `${keyPath}.enrolled`;
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * The enrollment of a self-hosted install, when ENROLLMENT_* is set (the
 * env check requires all three together) and it has not enrolled yet:
 * this install's primary tenant is the domain the bundle was issued for.
 */
export async function installEnrollmentFrom(
	env: Env,
	logger: Logger,
): Promise<InstallEnrollment | undefined> {
	const gateway = env.ENROLLMENT_GATEWAY;
	const bundlePath = env.ENROLLMENT_BUNDLE_PATH;
	const keyPath = env.ENROLLMENT_KEY_PATH;
	if (!gateway || !bundlePath || !keyPath) return undefined;
	const marker = enrolledMarkerPath(keyPath);
	if (await exists(marker)) return undefined;
	return createInstallEnrollment({
		gateway,
		bundlePath,
		keyPath,
		issuer: env.ISSUER,
		domain: env.TENANT_DOMAIN,
		logger,
		onEnrolled: () =>
			writeFile(marker, `${new Date().toISOString()}\n`, { mode: 0o600 }),
	});
}
