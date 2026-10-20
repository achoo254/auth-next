import type { Section } from "./domain-guide-sections.js";

/**
 * Install instructions of the self-hosted bundle (ADR 0007), in the
 * public repository that ships it.
 */
export const SELF_HOSTED_INSTALL_GUIDE =
	"https://github.com/achoo254/auth-next/blob/main/docs/self-hosted-install.md";

/**
 * Running a domain on its owner's servers, and moving one there: shown
 * only where /claim offers it (SELF_HOSTED_CLAIMS).
 */
export const SELF_HOSTED_SECTION: Section = {
	id: "self-hosted",
	title: "guide.self.title",
	blocks: [
		{ paragraph: "guide.self.body" },
		{
			list: ["guide.self.server", "guide.self.cloudflare", "guide.self.apps"],
		},
		{ paragraph: "guide.self.duty" },
		{ paragraph: "guide.self.move" },
	],
};
