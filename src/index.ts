/**
 * Entry point for the Worker.
 *
 * OAuthProvider does three jobs:
 *  1. Serves the MCP endpoints (/mcp and /sse) that Claude talks to.
 *  2. Runs a full OAuth 2.1 server (with Dynamic Client Registration) so
 *     Claude.ai / Claude mobile can securely connect.
 *  3. Hands the actual "log in with Google" part to GoogleHandler.
 */
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { GoogleEditorMCP } from "./mcp";
import { GoogleHandler } from "./google-handler";

// The Durable Object class must be exported so Cloudflare can find it.
export { GoogleEditorMCP };

export default new OAuthProvider({
  apiHandlers: {
    // Streamable HTTP transport (what Claude uses today)
    "/mcp": GoogleEditorMCP.serve("/mcp"),
    // SSE transport (older fallback, kept for compatibility)
    "/sse": GoogleEditorMCP.serveSSE("/sse"),
  },
  defaultHandler: GoogleHandler as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
