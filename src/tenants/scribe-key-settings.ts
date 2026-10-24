import { probeScribeKey, scribeKeyFormatOk } from "./scribe-key-probes.js";
import {
	SCRIBE_TRANSCRIPTION_VENDORS,
	type ScribeVendor,
	scribeKeyKind,
} from "./scribe-vendors.js";
import type { Tenancy } from "./tenancy.js";
import type { TenantDocument } from "./tenant-registry.js";
import type { ScribeSealedKey } from "./tenant-secrets.js";
import { type SettingResult, applied } from "./tenant-settings.js";

/** What /admin shows of a saved AI key: never the key, only its last 4 characters. */
export type ScribeKeySummary = Omit<ScribeSealedKey, "sealed">;

function transcribes(vendor: ScribeVendor): boolean {
	return SCRIBE_TRANSCRIPTION_VENDORS.includes(vendor);
}

/** The tenant's AI keys for /admin, without their sealed values. */
export async function scribeKeySummaries(
	tenancy: Tenancy,
	tenantId: string,
): Promise<ScribeKeySummary[]> {
	const keys = await tenancy.secrets.sealedForScribe(tenantId);
	return keys.map(({ sealed: _sealed, ...summary }) => summary);
}

/**
 * Keeps an AI key for Scribe once its provider accepted it (ADR 0012):
 * sealed to Scribe's public key, so the IdP cannot read it back. The first
 * transcription key turns Scribe on for the tenant.
 */
export async function saveScribeKey(
	tenancy: Tenancy,
	tenant: TenantDocument,
	vendor: ScribeVendor,
	input: string,
): Promise<SettingResult> {
	const sealing = tenancy.scribe;
	const key = input.trim();
	if (!sealing || !scribeKeyFormatOk(vendor, key)) return "invalid";
	const verdict = await probeScribeKey(tenancy.fetch, vendor, key);
	if (verdict !== "valid") return `scribe-key-${verdict}`;
	await tenancy.secrets.putForScribe(
		tenant._id,
		vendor,
		key,
		sealing.publicKey,
	);
	if (transcribes(vendor)) {
		await tenancy.registry.setScribeEnabled(tenant._id, true);
	}
	return applied(tenancy, tenant, scribeKeyKind(vendor));
}

/** Removes an AI key; without a transcription key left, Scribe turns off. */
export async function removeScribeKey(
	tenancy: Tenancy,
	tenant: TenantDocument,
	vendor: ScribeVendor,
): Promise<SettingResult> {
	const kind = scribeKeyKind(vendor);
	if (!(await tenancy.secrets.has(tenant._id, kind))) return "saved";
	await tenancy.secrets.remove(tenant._id, kind);
	const left = await tenancy.secrets.sealedForScribe(tenant._id);
	if (!left.some((saved) => transcribes(saved.vendor))) {
		await tenancy.registry.setScribeEnabled(tenant._id, false);
	}
	return applied(tenancy, tenant, kind);
}
