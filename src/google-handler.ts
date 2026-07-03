/**
 * Handles the "Sign in with Google" part of the flow.
 *
 * When Claude wants to connect, it sends the user to /authorize here.
 * We bounce them to Google's consent screen. Google sends them back to
 * /callback with a code, which we trade for a refresh token. That refresh
 * token is stored (encrypted by the OAuth provider) in the user's session
 * props, so every MCP tool call can act on their Google account.
 */
import { Hono } from "hono";
import type { OAuthHelpers, AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Props } from "./mcp";

type Bindings = {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
};

// What we ask Google permission for:
//  - drive:        find/open files anywhere in the user's Drive
//  - documents:    read + edit Google Docs
//  - spreadsheets: read + edit Google Sheets
//  - email:        identify which Google account connected
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

const app = new Hono<{ Bindings: Bindings }>();

/**
 * Step 1: Claude sends the user here. We stash Claude's OAuth request in the
 * `state` parameter and redirect the user to Google's consent screen.
 */
app.get("/authorize", async (c) => {
  const oauthReqInfo: AuthRequest = await c.env.OAUTH_PROVIDER.parseAuthRequest(
    c.req.raw
  );
  if (!oauthReqInfo.clientId) {
    return c.text("Invalid OAuth request: missing client id", 400);
  }

  const redirectUri = new URL("/callback", c.req.url).href;

  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleAuthUrl.searchParams.set("client_id", c.env.GOOGLE_CLIENT_ID);
  googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("scope", GOOGLE_SCOPES);
  // These two lines make Google give us a long-lived refresh token,
  // so you only have to sign in once.
  googleAuthUrl.searchParams.set("access_type", "offline");
  googleAuthUrl.searchParams.set("prompt", "consent");
  googleAuthUrl.searchParams.set(
    "state",
    btoa(JSON.stringify(oauthReqInfo))
  );

  return c.redirect(googleAuthUrl.href);
});

/**
 * Step 2: Google sends the user back here with a one-time code.
 * We exchange it for tokens, then complete Claude's OAuth request.
 */
app.get("/callback", async (c) => {
  const code = c.req.query("code");
  const stateParam = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    return c.text(`Google sign-in failed: ${error}`, 400);
  }
  if (!code || !stateParam) {
    return c.text("Missing code or state from Google", 400);
  }

  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = JSON.parse(atob(stateParam));
  } catch {
    return c.text("Invalid state parameter", 400);
  }

  const redirectUri = new URL("/callback", c.req.url).href;

  // Trade the one-time code for tokens
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResp.ok) {
    const body = await tokenResp.text();
    return c.text(`Failed to exchange code with Google: ${body}`, 500);
  }

  const tokens = (await tokenResp.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  if (!tokens.refresh_token) {
    return c.text(
      "Google did not return a refresh token. Go to https://myaccount.google.com/permissions, remove this app's access, then try connecting again.",
      500
    );
  }

  // Find out which Google account this is (used as the user id)
  const userInfoResp = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    { headers: { Authorization: `Bearer ${tokens.access_token}` } }
  );
  const userInfo = (await userInfoResp.json()) as { email?: string };
  const email = userInfo.email ?? "unknown-user";

  // Hand control back to the OAuth provider: it issues Claude its own
  // token and attaches our Google refresh token as encrypted "props".
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: email,
    metadata: { label: email },
    scope: oauthReqInfo.scope,
    props: {
      email,
      refreshToken: tokens.refresh_token,
    } satisfies Props,
  });

  return c.redirect(redirectTo);
});

/** Simple homepage so visiting the URL in a browser shows something sane. */
app.get("/", (c) =>
  c.text(
    "Claude Google Docs & Sheets editor is running. Add this URL as a custom connector in Claude (Settings > Connectors)."
  )
);

export const GoogleHandler = app;
