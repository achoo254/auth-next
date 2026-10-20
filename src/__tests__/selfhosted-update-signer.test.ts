import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * update.sh hands SIGNER_IDENTITY to cosign --certificate-identity-regexp.
 * Releases are signed by the selfhosted-release workflow of the GitHub repo,
 * which is renamed from hoandat-auth to auth-next: an install must accept a
 * signature from either name, and nothing else.
 */

const SCRIPT = join(import.meta.dirname, "../../deploy/self-hosted/update.sh");
const WORKFLOW = ".github/workflows/selfhosted-release.yml";

/** The pattern exactly as bash expands it for the default owner. */
function signerIdentity(): RegExp {
	const source = readFileSync(SCRIPT, "utf8");
	const line = /^SIGNER_IDENTITY=.*$/m.exec(source)?.[0];
	if (!line) throw new Error("SIGNER_IDENTITY not found in update.sh");
	const expanded = execFileSync(
		"bash",
		["-c", `SIGNER_OWNER=achoo254\n${line}\nprintf %s "$SIGNER_IDENTITY"`],
		{ encoding: "utf8" },
	);
	return new RegExp(expanded);
}

describe("the self-hosted update script's signer identity", () => {
	const identity = signerIdentity();

	it.each(["hoandat-auth", "auth-next"])(
		"accepts the release workflow of %s",
		(repo) => {
			expect(
				identity.test(
					`https://github.com/achoo254/${repo}/${WORKFLOW}@refs/heads/main`,
				),
			).toBe(true);
		},
	);

	it.each([
		[
			"another owner",
			`https://github.com/evil/auth-next/${WORKFLOW}@refs/heads/main`,
		],
		[
			"another repo",
			`https://github.com/achoo254/auth-nextx/${WORKFLOW}@refs/heads/main`,
		],
		[
			"another workflow",
			"https://github.com/achoo254/auth-next/.github/workflows/ci.yml@refs/heads/main",
		],
		[
			"a dot wildcard",
			"https://github.com/achoo254/auth-next/x.github/workflows/selfhosted-release.yml@refs/heads/main",
		],
		[
			"a prefixed host",
			`https://evil.example/https://github.com/achoo254/auth-next/${WORKFLOW}@refs/heads/main`,
		],
	])("rejects %s", (_label, candidate) => {
		expect(identity.test(candidate)).toBe(false);
	});
});
