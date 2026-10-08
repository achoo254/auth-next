import { request } from "node:http";

/**
 * GET with an arbitrary Host header, which fetch does not allow. Resolves
 * with the status code and the body as text.
 */
export function getWithHost(
	url: string,
	host: string,
	headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const req = request(url, { headers: { ...headers, host } }, (res) => {
			let body = "";
			res.setEncoding("utf8");
			res.on("data", (chunk: string) => {
				body += chunk;
			});
			res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
		});
		req.once("error", reject);
		req.end();
	});
}
