# Setup Guide — Claude Google Docs & Sheets Editor

Follow these steps in order, on a computer. Total time: about 45–90 minutes.
You will never write code. When in doubt, paste any error message back into Claude.

---

## What you'll end up with

A tiny program ("connector") hosted for free on Cloudflare. Claude — including
the mobile app — talks to it, and it edits your Google Docs and Sheets for you.

---

## PART 1 — Tell Google an app will edit your files (~20 min)

1. Go to **console.cloud.google.com** and sign in with the Google account that
   owns your Docs/Sheets.
2. At the top of the page, click the **project dropdown** → **New Project**.
   Name: `Claude Editor`. Click **Create**, then make sure it's selected in the
   dropdown.
3. In the top search bar, type **Google Docs API** → click the result → click
   **Enable**.
4. Repeat step 3 for **Google Sheets API** and **Google Drive API**.
   (Three APIs total must say "Enabled".)
5. Search **OAuth consent screen** → click it.
   - If asked, choose **External** → Create.
   - App name: `Claude Editor`. User support email: your email.
     Developer contact: your email. Click **Save and Continue** through every
     screen (skip scopes and optional stuff).
   - If you see an **Audience** or **Test users** section: click **Add users**
     and add your own email address. (While the app is in "Testing" mode, only
     listed emails can sign in — that's you.)
6. Search **Credentials** → click it → **+ Create Credentials** →
   **OAuth client ID**.
   - Application type: **Web application**
   - Name: `Claude Editor`
   - Under **Authorized redirect URIs**, click **+ Add URI** and paste a
     placeholder for now: `https://example.com/callback`
     (we'll fix this in Part 2, Step 8 — Google requires something here)
   - Click **Create**.
7. A pop-up shows your **Client ID** and **Client Secret**. Copy BOTH into a
   note on your phone or computer. Keep the Secret private.

✅ Part 1 done.

---

## PART 2 — Put the connector on the internet (~25 min)

### Upload the code to GitHub

1. Make a free account at **github.com** (if you don't have one).
2. On github.com, click the **+** (top right) → **New repository**.
   - Name: `claude-gdocs-editor`
   - Set it to **Private**
   - Click **Create repository**.
3. On the new empty repo page, click the link that says
   **"uploading an existing file"**. Drag ALL the files and the `src` folder
   from this package into the upload box. Click **Commit changes**.
   - ⚠️ Make sure the `src` folder uploaded WITH its 4 files inside. If your
     browser won't drag a folder, open `src` and upload its files, then use
     GitHub's "Create new file" trick: name the file `src/index.ts` (typing
     `src/` creates the folder) and paste the contents in.

### Create the storage bucket (KV namespace)

4. Make a free account at **dash.cloudflare.com**.
   - In the left menu: **Storage & Databases** → **KV** → **Create a namespace**.
   - Name: `OAUTH_KV` → Create.
   - You'll see an **ID** (long string of letters/numbers). Copy it.
5. Back on GitHub, open the file **wrangler.jsonc** → click the ✏️ pencil to
   edit → find `PASTE_YOUR_KV_NAMESPACE_ID_HERE` and replace it with the ID you
   just copied (keep the quotes). Click **Commit changes**.

### Deploy on Cloudflare

6. In the Cloudflare dashboard: **Compute (Workers)** → **Create** →
   **Import a repository** (connect your GitHub account when asked) →
   choose `claude-gdocs-editor`.
   - Leave the build settings as-is (it auto-detects Wrangler) → **Deploy**.
   - Wait for the build to finish (1–3 min).
7. On the Worker's page, find its URL. It looks like:
   `https://claude-gdocs-editor.YOURNAME.workers.dev`
   Copy it — this is your connector's address.

### Connect the wires

8. Go back to **console.cloud.google.com** → search **Credentials** → click
   your `Claude Editor` OAuth client → under **Authorized redirect URIs**,
   replace the placeholder with:
   `https://claude-gdocs-editor.YOURNAME.workers.dev/callback`
   (your real Worker URL + `/callback`). Click **Save**.
9. In Cloudflare, on your Worker's page: **Settings** → **Variables and
   Secrets** → **Add**:
   - Type: **Secret**, Name: `GOOGLE_CLIENT_ID`, Value: (paste your Client ID) → Save
   - Type: **Secret**, Name: `GOOGLE_CLIENT_SECRET`, Value: (paste your Client Secret) → Save
10. Redeploy so the secrets take effect: on the Worker page go to
    **Deployments** → **⋯** on the latest → **Retry/Redeploy** (or just make
    any tiny edit on GitHub and commit — it auto-redeploys).

✅ Part 2 done. Visit your Worker URL in a browser — you should see a short
"is running" message.

---

## PART 3 — Connect it to Claude (~5 min)

1. On a computer, go to **claude.ai** → **Settings** → **Connectors**.
2. Click **Add custom connector**.
   - Name: `My Google Editor`
   - URL: your Worker URL (e.g. `https://claude-gdocs-editor.YOURNAME.workers.dev/mcp`)
   - Click **Add**.
3. Click **Connect** next to it. A Google sign-in window opens → choose your
   account → click **Continue/Allow**. (Google may warn the app is unverified
   because it's in testing mode — click **Continue**. It's your own app.)
4. Done. It syncs to your phone automatically.

---

## PART 4 — Use it from your phone

1. Open the Claude mobile app → start a chat → tap **+** → **Connectors** →
   toggle on **My Google Editor**.
2. Try: *"Search my Drive for my job application tracker and read the first
   20 rows."* Then: *"Add a row: Gartner, VP Analyst, Interview scheduled."*

---

## If something breaks

- **"Disconnected" in Claude:** URL must end in `/mcp`. Also confirm both
  secrets are set in Cloudflare and you redeployed after adding them.
- **Google error 400 redirect_uri_mismatch:** the redirect URI in Google
  Credentials must EXACTLY match your Worker URL + `/callback`.
- **Google "app not verified" warning:** normal for personal apps in testing
  mode. Click Advanced → Continue.
- **Sign-in works once then fails later:** in testing mode Google expires
  refresh tokens after 7 days. Fix: OAuth consent screen → **Publish app**
  (push to Production). You don't need Google's verification for personal use;
  you'll just see the "unverified" warning at sign-in.
- Anything else: paste the error into Claude and ask for help.
