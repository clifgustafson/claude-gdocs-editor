/**
 * Thin helpers around Google's REST APIs.
 *
 * Google access tokens only last ~1 hour, so we keep the long-lived
 * refresh token and swap it for a fresh access token whenever needed.
 */

export interface GoogleEnv {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let tokenCache: Map<string, CachedToken> = new Map();

/** Get a valid access token, refreshing from Google if the cached one expired. */
export async function getAccessToken(
  env: GoogleEnv,
  refreshToken: string
): Promise<string> {
  const cached = tokenCache.get(refreshToken);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Could not refresh Google access token (${resp.status}): ${body}. ` +
        `If this persists, disconnect and reconnect the connector in Claude settings.`
    );
  }

  const data = (await resp.json()) as {
    access_token: string;
    expires_in: number;
  };

  tokenCache.set(refreshToken, {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });

  return data.access_token;
}

/** Make an authenticated call to a Google API and return parsed JSON. */
export async function googleFetch(
  env: GoogleEnv,
  refreshToken: string,
  url: string,
  init: RequestInit = {}
): Promise<any> {
  const accessToken = await getAccessToken(env, refreshToken);
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Google API error ${resp.status} for ${url}: ${body}`);
  }

  // Some endpoints (rare) return empty bodies
  const text = await resp.text();
  return text ? JSON.parse(text) : {};
}

/**
 * Convert a Google Docs document JSON structure into readable plain text.
 * Walks paragraphs and tables; ignores images/drawings.
 */
export function docToPlainText(doc: any): string {
  const out: string[] = [];

  function walkContent(content: any[]) {
    for (const element of content ?? []) {
      if (element.paragraph) {
        let line = "";
        for (const pe of element.paragraph.elements ?? []) {
          if (pe.textRun?.content) line += pe.textRun.content;
        }
        out.push(line);
      } else if (element.table) {
        for (const row of element.table.tableRows ?? []) {
          const cells: string[] = [];
          for (const cell of row.tableCells ?? []) {
            const cellText: string[] = [];
            for (const cc of cell.content ?? []) {
              for (const pe of cc.paragraph?.elements ?? []) {
                if (pe.textRun?.content)
                  cellText.push(pe.textRun.content.replace(/\n/g, " "));
              }
            }
            cells.push(cellText.join("").trim());
          }
          out.push("| " + cells.join(" | ") + " |");
        }
      } else if (element.tableOfContents) {
        walkContent(element.tableOfContents.content ?? []);
      }
    }
  }

  walkContent(doc.body?.content ?? []);
  return out.join("").trim();
}

/** Find the index right before the end of the document body (for appending). */
export function docEndIndex(doc: any): number {
  const content = doc.body?.content ?? [];
  const last = content[content.length - 1];
  // endIndex points *past* the final newline; we insert just before it.
  return Math.max(1, (last?.endIndex ?? 2) - 1);
}
