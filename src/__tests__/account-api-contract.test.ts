import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppLinkCompletion } from "../interactions/app-link-result.js";
import { callApi, signedInApp } from "./helpers/account-ios-flows.js";
import { localmanSignIn } from "./helpers/exchange-flows.js";
import { FAKE_UPSTREAM_ENV } from "./helpers/fake-upstreams.js";
import { cliLogin } from "./helpers/session-flows.js";
import { repositoryOf } from "./helpers/test-accounts.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

/** The fixtures the iOS app decodes in its own tests (ios/contract/README.md). */
const CONTRACT_DIR = join(import.meta.dirname, "..", "..", "ios", "contract");

/**
 * Both sides check against it, so a change of GET /api/account that the
 * app would not read fails here.
 */
const FIXTURE = join(CONTRACT_DIR, "account.json");

type Shape =
	| "string"
	| "number"
	| "boolean"
	| "null"
	| { readonly array: Shape | "empty" }
	| { readonly [key: string]: Shape };

/** Keys and value kinds of a JSON value; arrays by their first element. */
function shapeOf(value: unknown): Shape {
	if (value === null) return "null";
	if (Array.isArray(value)) {
		return { array: value.length > 0 ? shapeOf(value[0]) : "empty" };
	}
	if (typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, item]) => [key, shapeOf(item)]),
		);
	}
	if (typeof value === "string") return "string";
	if (typeof value === "number") return "number";
	return "boolean";
}

/** A value that is null on one side may be anything on the other. */
function sameShape(actual: Shape, expected: Shape, path: string): string[] {
	if (actual === "null" || expected === "null") return [];
	if (typeof actual === "string" || typeof expected === "string") {
		return actual === expected
			? []
			: [`${path}: ${String(actual)} vs ${String(expected)}`];
	}
	if ("array" in actual || "array" in expected) {
		const a = Reflect.get(actual, "array");
		const e = Reflect.get(expected, "array");
		if (a === undefined || e === undefined) return [`${path}: array vs object`];
		if (a === "empty" || e === "empty") return [];
		return sameShape(a, e, `${path}[]`);
	}
	const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
	return [...keys].flatMap((key) => {
		const a = Reflect.get(actual, key);
		const e = Reflect.get(expected, key);
		if (a === undefined) return [`${path}.${key}: missing from the API`];
		if (e === undefined) return [`${path}.${key}: missing from the fixture`];
		return sameShape(a, e, `${path}.${key}`);
	});
}

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({
		interactions: "real",
		rateLimits: [],
		env: FAKE_UPSTREAM_ENV,
	});
});

afterAll(async () => {
	await idp?.close();
});

describe("link completion and the app's fixture", () => {
	it("uses a result the server can answer", () => {
		const fixture: unknown = JSON.parse(
			readFileSync(join(CONTRACT_DIR, "link-complete.json"), "utf8"),
		);
		const results: readonly AppLinkCompletion[] = [
			"linked",
			"owned_by_other",
			"already_linked",
			"expired",
			"failed",
		];
		expect(fixture).toEqual({ result: expect.any(String) });
		expect(results).toContain(Reflect.get(Object(fixture), "result"));
	});
});

describe("GET /api/account and the app's fixture", () => {
	it("have the same keys and value kinds", async () => {
		expect(
			existsSync(FIXTURE),
			`the shared fixture ${FIXTURE} is missing`,
		).toBe(true);
		const app = await signedInApp(idp);
		// Every list filled: a browser session, a CLI device, an app.
		await localmanSignIn(idp, app.account);
		await cliLogin(idp, app.browser);
		await repositoryOf(idp).links.setTelegram(app.account._id, {
			chatId: `${Date.now()}`,
			username: "tg_user",
			name: "TG",
		});
		await repositoryOf(idp).updateName(app.account._id, "Name");
		const answer = await callApi(idp, "/", { token: app.accessToken });
		const actual = shapeOf(await answer.json());
		const expected = shapeOf(JSON.parse(readFileSync(FIXTURE, "utf8")));
		expect(sameShape(actual, expected, "$")).toEqual([]);
	});
});
