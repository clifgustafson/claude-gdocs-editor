# Claude Google Docs & Sheets Editor

A remote MCP server (custom connector) that lets Claude — including the Claude
mobile app — search Google Drive and **edit Google Docs and Sheets in real
time**.

Runs free on Cloudflare Workers. Sign-in is handled with Google OAuth, so it
only ever touches the account you approve.

## Tools Claude gets

| Tool | What it does |
|---|---|
| `search_files` | Find Docs/Sheets/files in your Drive |
| `list_files_in_folder` | List a folder's contents by folder ID |
| `read_doc` | Read a Google Doc's full text |
| `append_to_doc` | Add text to the end of a Doc |
| `replace_text_in_doc` | Find & replace inside a Doc |
| `create_doc` | Create a new Doc (optionally inside a folder) |
| `list_sheet_tabs` | List the tabs in a spreadsheet |
| `read_sheet` | Read cell values from a range |
| `update_cells` | Overwrite specific cells |
| `append_rows` | Add rows to the bottom of a table |
| `whoami` | Show the connected Google account |

## Setup

Follow **SETUP.md** — it's written step-by-step for non-developers.

## Security notes

- Keep this repository **private**.
- Your Google Client Secret lives only in Cloudflare's encrypted secrets —
  never in this code.
- Your Google refresh token is stored encrypted by the OAuth provider layer.
- To revoke everything: remove the connector in Claude settings and revoke the
  app at https://myaccount.google.com/permissions
