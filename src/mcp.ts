/**
 * The MCP agent: this defines the actual "tools" Claude gets when the
 * connector is enabled — searching Drive, reading and editing Docs,
 * reading and editing Sheets.
 */
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  googleFetch,
  docToPlainText,
  docEndIndex,
  type GoogleEnv,
} from "./google-api";

/** Data attached to each authenticated user session. */
export type Props = {
  email: string;
  refreshToken: string;
};

type Env = GoogleEnv & {
  OAUTH_KV: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;
};

const DRIVE = "https://www.googleapis.com/drive/v3";
const DOCS = "https://docs.googleapis.com/v1";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

export class GoogleEditorMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name: "Google Docs & Sheets Editor",
    version: "1.0.0",
  });

  private g(url: string, init?: RequestInit) {
    return googleFetch(this.env, this.props.refreshToken, url, init);
  }

  async init() {
    // ---------------- DRIVE ----------------

    this.server.tool(
      "search_files",
      "Search the user's Google Drive for Docs, Sheets, or any files by name or content. Returns file IDs needed by the other tools.",
      {
        query: z.string().describe("Search text, e.g. a file name or keywords"),
        onlyType: z
          .enum(["docs", "sheets", "any"])
          .optional()
          .describe("Limit results to Google Docs, Google Sheets, or any file type"),
      },
      async ({ query, onlyType }) => {
        const safe = query.replace(/'/g, "\\'");
        let q = `(name contains '${safe}' or fullText contains '${safe}') and trashed = false`;
        if (onlyType === "docs")
          q += ` and mimeType = 'application/vnd.google-apps.document'`;
        if (onlyType === "sheets")
          q += ` and mimeType = 'application/vnd.google-apps.spreadsheet'`;

        const url =
          `${DRIVE}/files?q=${encodeURIComponent(q)}` +
          `&fields=${encodeURIComponent("files(id,name,mimeType,modifiedTime,webViewLink)")}` +
          `&pageSize=15&orderBy=modifiedTime desc` +
          `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

        const data = await this.g(url);
        const files = data.files ?? [];
        if (files.length === 0) return text(`No files found matching "${query}".`);

        const lines = files.map(
          (f: any) =>
            `• ${f.name}\n  id: ${f.id}\n  type: ${f.mimeType}\n  modified: ${f.modifiedTime}\n  link: ${f.webViewLink}`
        );
        return text(lines.join("\n\n"));
      }
    );

    this.server.tool(
      "list_files_in_folder",
      "List the files inside a specific Google Drive folder (by folder ID).",
      {
        folderId: z.string().describe("The Drive folder ID"),
      },
      async ({ folderId }) => {
        const q = `'${folderId}' in parents and trashed = false`;
        const url =
          `${DRIVE}/files?q=${encodeURIComponent(q)}` +
          `&fields=${encodeURIComponent("files(id,name,mimeType,modifiedTime)")}` +
          `&pageSize=50&orderBy=modifiedTime desc` +
          `&supportsAllDrives=true&includeItemsFromAllDrives=true`;
        const data = await this.g(url);
        const files = data.files ?? [];
        if (files.length === 0) return text("That folder is empty (or not accessible).");
        return text(
          files
            .map((f: any) => `• ${f.name} — id: ${f.id} (${f.mimeType})`)
            .join("\n")
        );
      }
    );

    // ---------------- GOOGLE DOCS ----------------

    this.server.tool(
      "read_doc",
      "Read the full text content of a Google Doc.",
      {
        documentId: z.string().describe("The Google Doc ID (from search_files or the doc's URL)"),
      },
      async ({ documentId }) => {
        const doc = await this.g(`${DOCS}/documents/${documentId}`);
        const body = docToPlainText(doc);
        return text(`Title: ${doc.title}\n\n${body || "(empty document)"}`);
      }
    );

    this.server.tool(
      "append_to_doc",
      "Add text to the END of a Google Doc. Use \\n for new lines.",
      {
        documentId: z.string().describe("The Google Doc ID"),
        textToAdd: z.string().describe("The text to append"),
      },
      async ({ documentId, textToAdd }) => {
        const doc = await this.g(`${DOCS}/documents/${documentId}`);
        const index = docEndIndex(doc);
        await this.g(`${DOCS}/documents/${documentId}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({
            requests: [
              {
                insertText: {
                  location: { index },
                  text: textToAdd.startsWith("\n") ? textToAdd : "\n" + textToAdd,
                },
              },
            ],
          }),
        });
        return text(`Appended ${textToAdd.length} characters to "${doc.title}".`);
      }
    );

    this.server.tool(
      "replace_text_in_doc",
      "Find and replace text in a Google Doc. Replaces ALL occurrences of the exact text.",
      {
        documentId: z.string().describe("The Google Doc ID"),
        find: z.string().describe("The exact text to find"),
        replaceWith: z.string().describe("The replacement text"),
        matchCase: z.boolean().optional().describe("Case-sensitive match (default true)"),
      },
      async ({ documentId, find, replaceWith, matchCase }) => {
        const result = await this.g(`${DOCS}/documents/${documentId}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({
            requests: [
              {
                replaceAllText: {
                  containsText: { text: find, matchCase: matchCase ?? true },
                  replaceText: replaceWith,
                },
              },
            ],
          }),
        });
        const count =
          result.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0;
        return text(
          count > 0
            ? `Replaced ${count} occurrence(s) of "${find}".`
            : `No occurrences of "${find}" were found. Tip: use read_doc first to see the exact wording.`
        );
      }
    );

    this.server.tool(
      "create_doc",
      "Create a brand-new Google Doc, optionally with starting content.",
      {
        title: z.string().describe("Title for the new document"),
        initialText: z.string().optional().describe("Optional starting text"),
        folderId: z.string().optional().describe("Optional Drive folder ID to place it in"),
      },
      async ({ title, initialText, folderId }) => {
        const doc = await this.g(`${DOCS}/documents`, {
          method: "POST",
          body: JSON.stringify({ title }),
        });
        if (initialText) {
          await this.g(`${DOCS}/documents/${doc.documentId}:batchUpdate`, {
            method: "POST",
            body: JSON.stringify({
              requests: [
                { insertText: { location: { index: 1 }, text: initialText } },
              ],
            }),
          });
        }
        if (folderId) {
          await this.g(
            `${DRIVE}/files/${doc.documentId}?addParents=${folderId}&supportsAllDrives=true`,
            { method: "PATCH", body: JSON.stringify({}) }
          );
        }
        return text(
          `Created "${title}".\nid: ${doc.documentId}\nlink: https://docs.google.com/document/d/${doc.documentId}/edit`
        );
      }
    );

    // ---------------- GOOGLE SHEETS ----------------

    this.server.tool(
      "list_sheet_tabs",
      "List the tabs (worksheets) inside a Google Sheets spreadsheet.",
      {
        spreadsheetId: z.string().describe("The spreadsheet ID"),
      },
      async ({ spreadsheetId }) => {
        const data = await this.g(
          `${SHEETS}/${spreadsheetId}?fields=properties.title,sheets.properties`
        );
        const tabs = (data.sheets ?? []).map(
          (s: any) =>
            `• ${s.properties.title} (${s.properties.gridProperties?.rowCount ?? "?"} rows × ${s.properties.gridProperties?.columnCount ?? "?"} cols)`
        );
        return text(`Spreadsheet: ${data.properties?.title}\n\nTabs:\n${tabs.join("\n")}`);
      }
    );

    this.server.tool(
      "read_sheet",
      "Read cell values from a Google Sheet range, e.g. 'Sheet1!A1:F50'. If no range given, reads the first 100 rows of the first tab.",
      {
        spreadsheetId: z.string().describe("The spreadsheet ID"),
        range: z
          .string()
          .optional()
          .describe("A1-notation range like 'Applications!A1:H100'"),
      },
      async ({ spreadsheetId, range }) => {
        const r = range ?? "A1:Z100";
        const data = await this.g(
          `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(r)}`
        );
        const rows: string[][] = data.values ?? [];
        if (rows.length === 0) return text("That range is empty.");
        const rendered = rows
          .map((row, i) => `${i + 1}: ${row.join(" | ")}`)
          .join("\n");
        return text(`Range ${data.range}:\n\n${rendered}`);
      }
    );

    this.server.tool(
      "update_cells",
      "Write values into specific cells of a Google Sheet. Overwrites the given range. 'values' is a list of rows, each row a list of cell strings.",
      {
        spreadsheetId: z.string().describe("The spreadsheet ID"),
        range: z
          .string()
          .describe("A1-notation range to write, e.g. 'Applications!B2:D2'"),
        values: z
          .array(z.array(z.string()))
          .describe('Rows of cell values, e.g. [["Interview scheduled","2026-07-10"]]'),
      },
      async ({ spreadsheetId, range, values }) => {
        const data = await this.g(
          `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
          {
            method: "PUT",
            body: JSON.stringify({ range, majorDimension: "ROWS", values }),
          }
        );
        return text(
          `Updated ${data.updatedCells ?? 0} cell(s) in range ${data.updatedRange}.`
        );
      }
    );

    this.server.tool(
      "append_rows",
      "Add new rows to the bottom of a table in a Google Sheet.",
      {
        spreadsheetId: z.string().describe("The spreadsheet ID"),
        range: z
          .string()
          .describe("The table's range or tab name, e.g. 'Applications' or 'Applications!A:H'"),
        values: z
          .array(z.array(z.string()))
          .describe("Rows to append, each row a list of cell strings"),
      },
      async ({ spreadsheetId, range, values }) => {
        const data = await this.g(
          `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
          {
            method: "POST",
            body: JSON.stringify({ majorDimension: "ROWS", values }),
          }
        );
        return text(
          `Appended ${values.length} row(s). Updated range: ${data.updates?.updatedRange ?? "unknown"}.`
        );
      }
    );

    this.server.tool(
      "whoami",
      "Show which Google account this connector is signed in as.",
      {},
      async () => text(`Connected as: ${this.props.email}`)
    );
  }
}
