# Sinemarka Google Photos Empty Album Cleaner

<p align="center">
  <img src="logo.png" alt="Sinemarka Google Photos Empty Album Cleaner" width="128" />
</p>

A Manifest V3 WebExtension (Chrome + Firefox) that finds and bulk-deletes **empty** Google Photos albums using your own signed-in browser session. Google Photos has no built-in way to delete albums in bulk — this fills that gap.

By [Sinemarka](https://dev.sinemarka.com) · Support: [dev@sinemarka.com](mailto:dev@sinemarka.com)

> Tested on a real account: it removed **5,599 empty albums** in a single run via the Google Photos web API.

## Features

- **Fast scan** of your entire album list via Google Photos' internal `batchexecute` album-list RPC, filtered to albums with `itemCount === 0`.
- **Watch while I scroll** fallback — if the fast scan is blocked, scroll the albums page and empty albums are collected live from the DOM.
- **Multi-select preview** — click to toggle, Shift+click for a range, Ctrl/Cmd+click for a single album, plus Select all / Clear.
- **API-based deletion** — deletes through the same request Google's own UI uses (learned at runtime, see below), so it scales to thousands of albums without touching the page DOM.
- **Batching + pause** — configurable batch size and pause between batches to avoid rate limiting.
- **Progress-safe resume** — the remaining queue is persisted, so if you Stop, close the panel, or reload the tab, you can resume where you left off.
- **Dry run**, live progress, per-album failure log, and a Totals panel (total albums, empty found, empty remaining, deleted this run, albums remaining).

## How deletion works (and why it's safe-ish)

Google does **not** document album deletion, and the internal RPC id changes over time, so this extension does not hardcode one. Instead it **learns the delete request from your own browser**:

1. You delete **one** empty album manually in Google Photos (open it → menu → *Delete album*).
2. A MAIN-world bridge observes the `batchexecute` request the page sends and extracts a reusable template (the album id is replaced with a placeholder). **No auth tokens are stored** — only the request shape.
3. The panel shows **“Fast delete is ready”**, and every selected album is then deleted by replaying that request via the API.

Because it replays the exact action the official UI performs, it is as safe as deleting by hand — but it is an **undocumented, unofficial API**. If Google changes it, just delete one album manually again to re-learn the request.

## Security & privacy

- Runs only on `https://photos.google.com/*` (host permission scoped to that origin).
- All internal messaging is validated to the exact page origin (`event.origin` checks; `postMessage` is sent to the specific origin, never `"*"`).
- Session tokens are read from the page's own globals and used only to call Google Photos on your behalf. They are **never persisted** and never leave your browser.
- The only data written to `chrome.storage.local` is your settings, the scanned album list, deletion progress, and the (token-free) learned request template.
- No analytics, no external servers, no network calls to anything other than `photos.google.com`.

## Development

```bash
npm install
npm run build      # builds dist/ (Chrome) and dist-firefox/ (Firefox)
npm run dev        # rebuild on change
npm run typecheck
```

The build produces two packages:

- `dist/` — Chrome (Side Panel API)
- `dist-firefox/` — Firefox (sidebar; requires Firefox 128+ for MAIN-world content scripts)

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist` folder
4. Click the toolbar icon to open the side panel (or use **Open in full tab**)

## Load in Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `dist-firefox/manifest.json`
4. Click the toolbar icon to toggle the sidebar

## Usage

1. Open `https://photos.google.com/albums` and sign in.
2. Open the extension (side panel / sidebar).
3. **Scan empty albums** (or use **Watch while I scroll** if the scan times out).
4. Arm fast delete: delete **one** empty album manually in Google Photos. The panel flips to “Fast delete is ready”.
5. Select the albums to delete (click / Shift+click / Ctrl+click / Select all).
6. Optionally tune **Batch size** and **Pause between batches**.
7. Type `DELETE`, then click **Delete selected album(s)**.

Tip: try **Dry run only** first, and after a small batch click **Refresh** → **Scan** to confirm the empty-album count actually dropped before doing the full run. If a run is interrupted, reopen the panel and click **Resume deletion**.

## Disclaimer

This tool uses undocumented Google Photos endpoints and automates your own logged-in session. Use at your own risk. Deletion is irreversible from the extension's perspective; deleted albums follow Google Photos' normal behavior (album containers are removed — your photos are not deleted). Not affiliated with or endorsed by Google.

## Support

Questions or issues: [dev@sinemarka.com](mailto:dev@sinemarka.com) · [dev.sinemarka.com](https://dev.sinemarka.com)

## Release packages

```bash
npm run release
```

Creates `release/google-photos-empty-album-cleaner-1.0.0-firefox.zip` and `-chrome.zip` for store upload.

## License

MIT © [Sinemarka](https://dev.sinemarka.com) — see [LICENSE](LICENSE).
