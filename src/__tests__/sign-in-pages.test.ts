import { describe, expect, it } from "vitest";
import {
	NO_PROVIDER_MESSAGE,
	renderLogin,
	renderSignup,
} from "../interactions/login-page.js";

const BASE = {
	host: "auth.example.test",
	uid: "uid-1",
	csrf: "csrf-token",
	forDevice: false,
};

describe("login and sign-up pages", () => {
	it("offer only Google and GitHub, and a cancel button", () => {
		const login = renderLogin({ ...BASE, providers: ["google", "github"] });
		expect(login).toContain('href="/interaction/uid-1/upstream/google"');
		expect(login).toContain('href="/interaction/uid-1/upstream/github"');
		expect(login).toContain("Đăng nhập với Google");
		expect(login).toContain('action="/interaction/uid-1/abort"');
		expect(login).not.toContain('type="password"');
		expect(login).not.toContain('name="identifier"');
		expect(login).not.toContain("Quên mật khẩu");
		expect(login).not.toContain("hoặc dùng mật khẩu");
		expect(login).not.toContain('action="/interaction/uid-1/login"');

		const signup = renderSignup({ ...BASE, providers: ["github"] });
		expect(signup).toContain("Đăng ký với GitHub");
		expect(signup).toContain('href="/interaction/uid-1/login"');
		expect(signup).not.toContain('type="password"');
		expect(signup).not.toContain("<form");
	});

	it("say so plainly when no provider is configured", () => {
		for (const html of [
			renderLogin({ ...BASE, providers: [] }),
			renderSignup({ ...BASE, providers: [] }),
		]) {
			expect(html).toContain('data-id="upstream-unavailable"');
			expect(html).toContain(NO_PROVIDER_MESSAGE);
			expect(html).not.toContain("/upstream/");
		}
	});
});
