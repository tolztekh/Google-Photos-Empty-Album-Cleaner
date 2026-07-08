# Firefox Add-ons (AMO) submission — v1.0.0

## Package to upload

`release/google-photos-empty-album-cleaner-1.0.0-firefox.zip`

Built from `dist-firefox/` (run `npm run build` then `npm run release`).

---

## Listing fields

### Name
```
Sinemarka Google Photos Empty Album Cleaner
```

### Add-on URL slug (if asked)
```
google-photos-empty-album-cleaner
```

### Summary (max ~250 chars — short tagline)
```
Find and bulk-delete empty Google Photos albums. Fast API scan, preview list, batch delete with pause and resume.
```

### Description (full listing)
```
Google Photos has no built-in way to bulk-delete empty albums. Sinemarka Google Photos Empty Album Cleaner helps you find albums with zero items and remove them safely from your signed-in browser session.

FEATURES
• Fast scan of your entire album list (internal album-list API)
• “Watch while I scroll” fallback when lazy-loading blocks a full scan
• Multi-select preview: click, Shift+range, Ctrl/Cmd toggle, Select all / Clear
• API-based bulk deletion (learns the delete request from one manual delete)
• Configurable batch size and pause between batches
• Progress-safe resume if you stop or close the panel mid-run
• Dry run mode, live progress, failure log, light/dark theme

HOW IT WORKS
1. Open https://photos.google.com/albums and sign in.
2. Open the extension sidebar and scan for empty albums.
3. Delete ONE empty album manually in Google Photos (menu → Delete album). The extension learns that action.
4. Select albums, type DELETE, and bulk-delete the rest via the same API path Google’s UI uses.

IMPORTANT
• Only empty album containers are removed — your photos are not deleted.
• Uses undocumented Google Photos web endpoints in your own session (same as using the website).
• Not affiliated with or endorsed by Google.

SUPPORT
• Email: dev@sinemarka.com
• Site: https://dev.sinemarka.com
• Source: https://github.com/tolztekh/Google-Photos-Empty-Album-Cleaner
```

### Categories (pick 1–2)
- **Photos** (primary)
- **Privacy & Security** (optional secondary — if not available, skip)

### License
```
MIT
```

### Homepage / Support links
| Field | URL |
|-------|-----|
| Homepage | https://dev.sinemarka.com |
| Support email | dev@sinemarka.com |
| Support site | https://github.com/tolztekh/Google-Photos-Empty-Album-Cleaner/issues |

### Privacy policy
If AMO requires a URL, use the GitHub README privacy section:
```
https://github.com/tolztekh/Google-Photos-Empty-Album-Cleaner#security--privacy
```
Or host a short page at `https://dev.sinemarka.com` if you prefer.

---

## Version 1.0.0 — Release notes
```
Initial public release.

• Scan empty albums via fast API or scroll/watch mode
• Multi-select preview and dry run
• Learn-once fast delete via batchexecute RPC
• Batch delete with pause and resume
• Light/dark theme, toasts, Sinemarka branding
• Firefox sidebar (requires Firefox 128+)
```

---

## Notes for reviewers

```
This extension only runs on https://photos.google.com/albums*.

PERMISSIONS
• storage — save settings, scan results, deletion progress, learned delete RPC template (no auth tokens)
• tabs — find the active Google Photos albums tab to send scan/delete messages

HOST PERMISSION
• https://photos.google.com/* — read session context and call Google Photos batchexecute from the page (credentials: include)

CONTENT SCRIPTS
• page.js (MAIN world, document_start) — reads page globals and observes batchexecute requests; postMessage is restricted to same origin only
• content.js (isolated) — scan, delete orchestration, communicates with sidebar UI

DELETE FLOW
Google does not publish an album-delete API. After the user manually deletes one album, we capture the batchexecute request shape (rpcid + f.req template with album id placeholder) and replay it for selected empty albums. No Google OAuth; uses the user’s existing signed-in session.

TESTING
1. Load temporary add-on from dist-firefox/manifest.json
2. Open https://photos.google.com/albums (test account with a few empty albums)
3. Scan → delete one album manually → bulk delete selected empties
4. Dry run can be used without deleting

Source code: https://github.com/tolztekh/Google-Photos-Empty-Album-Cleaner
```

---

## Permissions justification (if form asks per permission)

| Permission | Why |
|------------|-----|
| `storage` | Persist user settings (batch size, theme, dry run), album scan results, deletion queue for resume, and token-free learned delete RPC template |
| `tabs` | Locate the Google Photos albums tab in the focused window to run scan/delete in the correct page context |
| `https://photos.google.com/*` | Extension only works on Google Photos; batchexecute requests use the user’s existing cookies/session on that origin |

---

## Screenshots (upload order)

1. Ready — split view, empty albums visible (“No items”)
2. After scan — list filled, totals
3. Arm fast delete — manual Delete album dialog
4. Mid-delete — progress bar + toast
5. Done — albums removed, only non-empty remain
6. (Optional) Dark theme — same “done” state

Recommended size: **1280×800** or similar landscape crop.

---

## Technical

| Item | Value |
|------|--------|
| Manifest | MV3 |
| Gecko ID | `google-photos-empty-album-cleaner@tolztekh.github.io` |
| Min Firefox | 128.0 |
| Version | 1.0.0 |
