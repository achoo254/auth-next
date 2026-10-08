/** Fixed ports for the end-to-end run (the IdP and the fake client/tools). */
export const E2E_PORT = 4590;
export const E2E_TOOLS_PORT = 4591;
export const E2E_ISSUER = `http://127.0.0.1:${E2E_PORT}`;
/** Fake relying party: OAuth callbacks land here; also exposes test data. */
export const E2E_TOOLS = `http://127.0.0.1:${E2E_TOOLS_PORT}`;
export const MCP_CALLBACK = `${E2E_TOOLS}/callback`;
