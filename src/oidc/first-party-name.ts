/** Names of first-party apps, matched on a lookalike skeleton. */
const FIRST_PARTY_NAME_PATTERN = /localman|tunelo|hoandat/;

// Cyrillic and Greek letters that render like the Latin letters of the
// first-party names; NFKC alone keeps them distinct.
const CONFUSABLE_LETTERS: Readonly<Record<string, string>> = {
	"\u0430": "a", // Cyrillic а
	"\u0441": "c", // Cyrillic с
	"\u0435": "e", // Cyrillic е
	"\u043e": "o", // Cyrillic о
	"\u04bb": "h", // Cyrillic һ
	"\u0501": "d", // Cyrillic ԁ
	"\u04cf": "l", // Cyrillic ӏ
	"\u03b1": "a", // Greek α
	"\u03bf": "o", // Greek ο
	"\u03b9": "l", // Greek ι
};

/**
 * Reduces a display name to a skeleton so "Locaⅼman", "L o c a l m a n",
 * "LocaIman" or Cyrillic lookalikes still match a first-party name.
 */
function nameSkeleton(name: string): string {
	return [...name.normalize("NFKC").toLowerCase()]
		.map((char) => CONFUSABLE_LETTERS[char] ?? char)
		.join("")
		.replace(/[1|!i]/g, "l")
		.replace(/0/g, "o")
		.replace(/[^a-z]/g, "");
}

/**
 * True when a self-declared (DCR) client name reads like Localman, Tunelo
 * or hoandat. Such names are allowed, because MCP clients put the server
 * name the user chose into theirs ("Claude Code (localman)"), but the
 * consent page then warns that the app is not ours.
 */
export function imitatesFirstPartyName(name: string): boolean {
	return FIRST_PARTY_NAME_PATTERN.test(nameSkeleton(name));
}
