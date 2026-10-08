import { describe, expect, it } from "vitest";
import { html, trustedHtml } from "./html.js";

describe("html templates", () => {
	it("escapes every interpolated value", () => {
		const name = `"><script>alert('x')</script>&`;
		expect(html`<p title="${name}">${name}</p>`.value).toBe(
			'<p title="&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;">&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;</p>',
		);
	});

	it("nests templates and arrays without double escaping", () => {
		const items = ["a<b", "c&d"].map((text) => html`<li>${text}</li>`);
		expect(html`<ul>${items}</ul>`.value).toBe(
			"<ul><li>a&lt;b</li><li>c&amp;d</li></ul>",
		);
	});

	it("renders nothing for false, null and undefined, but keeps 0", () => {
		expect(html`${false}${null}${undefined}${0}`.value).toBe("0");
	});

	it("passes trusted provider markup through unchanged", () => {
		expect(html`${trustedHtml('<form id="op.logoutForm"></form>')}`.value).toBe(
			'<form id="op.logoutForm"></form>',
		);
	});
});
