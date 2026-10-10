/**
 * A translation of an English message group: every key of the English
 * source, nothing more (a missing or extra key fails the typecheck).
 */
export type Translation<T> = { readonly [K in keyof T]: string };
