import browser from "../lib/browser";
import { readRuntimeState } from "../lib/storage";
import type { RuntimeState, StoredSettings } from "../lib/types";

const rootElement = document.querySelector<HTMLDivElement>("#app");
if (!rootElement) {
  throw new Error("Popup root was not found.");
}
const root = rootElement;

const toastHostElement = document.querySelector<HTMLDivElement>("#toast-host");
if (!toastHostElement) {
  throw new Error("Toast host was not found.");
}
const toastHost = toastHostElement;

const REPO_URL = "https://github.com/tolztekh/Google-Photos-Empty-Album-Cleaner";
const SUPPORT_EMAIL = "dev@sinemarka.com";
const SITE_URL = "https://dev.sinemarka.com";

let state: RuntimeState;
let pageReady = false;
let confirmText = "";
let pollHandle: number | undefined;
let lastProgressPhase = "";
let lastProgressMessage = "";
let lastFastDeleteReady: boolean | null = null;

const selectedKeys = new Set<string>();
let albumsSignature = "";
let anchorIndex: number | null = null;

type ToastKind = "info" | "success" | "warn" | "error";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showToast(title: string, body = "", kind: ToastKind = "info", durationMs = 4200): void {
  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;
  toast.innerHTML = `
    <div class="toast-title">${escapeHtml(title)}</div>
    ${body ? `<div class="toast-body">${escapeHtml(body)}</div>` : ""}
  `;
  toastHost.appendChild(toast);
  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(6px)";
    toast.style.transition = "opacity 0.18s ease, transform 0.18s ease";
    window.setTimeout(() => toast.remove(), 200);
  }, durationMs);
}

async function callRuntime<T>(message: unknown): Promise<T> {
  const response = await browser.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error ?? "Unknown extension error.");
  }
  return response.result as T;
}

function syncSelectionWithAlbums(): void {
  const signature = state.albums.map((album) => album.mediaKey).join("|");
  if (signature === albumsSignature) {
    for (const key of [...selectedKeys]) {
      if (!state.albums.some((album) => album.mediaKey === key)) {
        selectedKeys.delete(key);
      }
    }
    return;
  }

  albumsSignature = signature;
  anchorIndex = null;
  selectedKeys.clear();
  for (const album of state.albums) {
    selectedKeys.add(album.mediaKey);
  }
}

function applyRowSelection(index: number, event: MouseEvent): void {
  const album = state.albums[index];
  if (!album) {
    return;
  }

  if (event.shiftKey && anchorIndex !== null) {
    const lo = Math.min(anchorIndex, index);
    const hi = Math.max(anchorIndex, index);
    for (let i = lo; i <= hi; i += 1) {
      const key = state.albums[i]?.mediaKey;
      if (key) {
        selectedKeys.add(key);
      }
    }
  } else if (event.ctrlKey || event.metaKey) {
    if (selectedKeys.has(album.mediaKey)) {
      selectedKeys.delete(album.mediaKey);
    } else {
      selectedKeys.add(album.mediaKey);
    }
    anchorIndex = index;
  } else {
    if (selectedKeys.has(album.mediaKey)) {
      selectedKeys.delete(album.mediaKey);
    } else {
      selectedKeys.add(album.mediaKey);
    }
    anchorIndex = index;
  }

  window.getSelection()?.removeAllRanges();
  render();
}

function applyTheme(theme: "dark" | "light"): void {
  document.documentElement.dataset.theme = theme;
}

function themeIcon(isLight: boolean): string {
  // Show the icon for the theme you can switch TO.
  if (isLight) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
    </svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4"></circle>
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path>
  </svg>`;
}

function maybeToastStateChanges(previousPhase: string, previousMessage: string, previousFastReady: boolean | null): void {
  const phase = state.progress.phase;
  const message = state.progress.message;
  const fastReady = Boolean(state.settings.deleteRpc);

  if (previousFastReady === false && fastReady) {
    showToast("Fast delete ready", "The delete action was learned. You can now bulk-delete via the API.", "success");
  }

  if (previousPhase === phase && previousMessage === message) {
    return;
  }

  if (phase === "confirm" && message.toLowerCase().includes("found")) {
    showToast("Scan complete", message, "success");
  } else if (phase === "confirm" && message.toLowerCase().includes("dry run")) {
    showToast("Dry run complete", message, "info");
  } else if (phase === "done") {
    showToast("Deletion finished", message, "success", 5200);
  } else if (phase === "error") {
    showToast("Action needed", message, "error", 6500);
  } else if (phase === "deleting" && previousPhase !== "deleting") {
    showToast("Deleting albums", "Progress is saved — you can Stop and Resume later if needed.", "info");
  }
}

function render(): void {
  syncSelectionWithAlbums();
  applyTheme(state.settings.theme ?? "dark");

  const total = state.scanScannedCount;
  const emptyFound = state.scanEmptyCount ?? state.albums.length;
  const remainingEmpty = state.albums.length;
  const computedDeleted = state.scanEmptyCount !== null ? Math.max(0, state.scanEmptyCount - remainingEmpty) : 0;
  const deletedThisScan = state.deleteInProgress ? state.deletedThisRun : Math.max(computedDeleted, state.deletedThisRun);
  const remainingTotal = total !== null ? Math.max(0, total - deletedThisScan) : null;
  const selectedCount = selectedKeys.size;
  const fastDeleteReady = Boolean(state.settings.deleteRpc);
  const progressPercent = state.progress.total > 0 ? Math.round((state.progress.completed / state.progress.total) * 100) : 0;
  const canDelete = confirmText === "DELETE" && selectedCount > 0 && state.progress.phase !== "deleting";
  const isLight = state.settings.theme === "light";

  root.innerHTML = `
    <div class="panel">
      <div class="card stack">
        <div>
          <div class="row brand">
            <img class="brand-logo" src="icons/icon-48.png" alt="Sinemarka" />
            <div class="brand-text">
              <strong>Sinemarka Google Photos Empty Album Cleaner</strong>
              <span class="small">Select empty albums, then delete the ones you choose.</span>
            </div>
            <div class="brand-actions">
              <button id="themeToggle" class="theme-button" type="button" title="${isLight ? "Switch to dark theme" : "Switch to light theme"}" aria-label="${isLight ? "Switch to dark theme" : "Switch to light theme"}">
                ${themeIcon(isLight)}
              </button>
              <span class="badge">${escapeHtml(state.scanSource ?? "idle")}</span>
            </div>
          </div>
        </div>
        <div class="stack">
          <label class="checkbox"><input id="includeShared" type="checkbox" ${state.settings.includeShared ? "checked" : ""} /> Include shared empty albums</label>
          <label class="checkbox"><input id="dryRun" type="checkbox" ${state.settings.dryRun ? "checked" : ""} /> Dry run only (count, don't delete)</label>
        </div>
        <div class="row batch-controls">
          <label class="field"><span class="small">Batch size</span><input id="batchSize" type="number" min="1" max="500" value="${state.settings.batchSize}" /></label>
          <label class="field"><span class="small">Pause between batches (ms)</span><input id="pauseMs" type="number" min="0" step="250" value="${state.settings.pauseMs}" /></label>
        </div>
        <div class="actions">
          <button id="scanButton" ${pageReady ? "" : "disabled"}>Scan empty albums</button>
          <button id="watchButton" class="secondary" ${pageReady ? "" : "disabled"}>${state.watching ? "Stop watching" : "Watch while I scroll"}</button>
          <button id="refreshButton" class="secondary">Refresh</button>
          <button id="openTabButton" class="secondary">Open in full tab</button>
          <button id="cancelButton" class="secondary" ${state.progress.phase === "deleting" ? "" : "disabled"}>Stop</button>
        </div>
        <div class="small">${pageReady ? "Active Google Photos tab is ready." : "Open https://photos.google.com/albums in a tab, then scan."}</div>
        <div class="small">Fast scan reads your whole album list. If it times out, use "Watch while I scroll" and scroll the albums page manually.</div>
        <div class="small ${fastDeleteReady ? "ok" : "warn"}">
          ${fastDeleteReady
            ? "Fast delete is ready — deletion uses the Google Photos API directly."
            : 'Fast delete not armed yet. Delete ONE empty album manually (open it, then "Delete album"). The extension learns the action and can then delete the rest automatically.'}
        </div>
      </div>

      <div class="card stack">
        <div class="row"><strong>Totals</strong><span class="badge">${selectedCount} selected</span></div>
        <div class="totals-grid">
          <div><span class="totals-num">${total ?? "—"}</span><span class="small">Total albums</span></div>
          <div><span class="totals-num">${emptyFound}</span><span class="small">Empty found</span></div>
          <div><span class="totals-num">${remainingEmpty}</span><span class="small">Empty remaining</span></div>
          <div><span class="totals-num">${deletedThisScan}</span><span class="small">Deleted this scan</span></div>
          <div><span class="totals-num">${remainingTotal ?? "—"}</span><span class="small">Albums remaining</span></div>
        </div>
        <div class="muted">${escapeHtml(state.progress.message)}</div>
        <div class="progress-bar"><span style="width:${progressPercent}%"></span></div>
        <div class="small">${state.progress.completed}/${state.progress.total || selectedCount} processed${state.progress.currentAlbumTitle ? ` - ${escapeHtml(state.progress.currentAlbumTitle)}` : ""}</div>
      </div>

      <div class="card stack">
        <div class="row">
          <strong>Empty albums</strong>
          <div class="actions">
            <button id="selectAllButton" class="secondary">Select all</button>
            <button id="selectNoneButton" class="secondary">Clear</button>
          </div>
        </div>
        <div class="small">Tip: click to toggle, Shift+click to select a range, Ctrl/Cmd+click to add one.</div>
        <div class="album-list">
          ${state.albums.length === 0 ? '<div class="small">No empty albums loaded yet. Run a scan.</div>' : state.albums.map((album, index) => {
            const selected = selectedKeys.has(album.mediaKey);
            return `
              <div class="album-item ${selected ? "selected" : ""}" data-index="${index}">
                <div class="row">
                  <span class="album-title">${escapeHtml(album.title)}</span>
                  ${album.isShared ? '<span class="badge">shared</span>' : ""}
                </div>
                <div class="small">Created ${album.creationTimestamp ? new Date(album.creationTimestamp).toLocaleString() : "unknown"}</div>
                <label class="checkbox"><input class="selectCheckbox" data-index="${index}" type="checkbox" ${selected ? "checked" : ""} /> Selected for deletion</label>
              </div>`;
          }).join("")}
        </div>
        <div class="stack">
          <input id="confirmInput" type="text" placeholder="Type DELETE to confirm" value="${escapeHtml(confirmText)}" />
          <button id="deleteButton" class="danger" ${canDelete ? "" : "disabled"}>${state.settings.dryRun ? `Preview ${selectedCount} (dry run)` : `Delete ${selectedCount} selected album(s)`}</button>
          ${state.pendingDeleteKeys.length > 0 && !state.deleteInProgress ? `<button id="resumeButton" class="danger">Resume deletion (${state.pendingDeleteKeys.length} remaining)</button>` : ""}
        </div>
      </div>

      ${state.progress.failures.length > 0 ? `
        <div class="card stack">
          <strong>Failures</strong>
          <div class="error-list">
            ${state.progress.failures.map((failure) => `<div>${escapeHtml(failure.title)}: ${escapeHtml(failure.reason)}</div>`).join("")}
          </div>
        </div>` : ""}

      <div class="disclaimer">
        <strong>Tips</strong>
        <div class="tips small">
          <div>1. Keep the Google Photos albums tab open while scanning or deleting.</div>
          <div>2. Use Dry run first, then delete a small batch and re-scan to confirm albums are gone.</div>
          <div>3. For large runs, keep batch size around 25–50 with a short pause between batches.</div>
          <div>4. If a run is interrupted, reopen the panel and use Resume deletion.</div>
        </div>
        <strong>Disclaimer</strong>
        <div class="small">This tool uses undocumented Google Photos endpoints and your signed-in browser session. Use at your own risk. Deletion is irreversible from the extension's perspective; album containers are removed, but your photos are not deleted. Not affiliated with or endorsed by Google.</div>
      </div>

      <div class="footer small">
        <div class="footer-links">
          <span>&copy; ${new Date().getFullYear()} <a href="${SITE_URL}" target="_blank" rel="noopener noreferrer">Sinemarka</a></span>
          <span>Support: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></span>
          <span><a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">GitHub</a></span>
        </div>
      </div>
    </div>
  `;

  bindEvents();
}

async function syncState(): Promise<void> {
  const previousPhase = lastProgressPhase;
  const previousMessage = lastProgressMessage;
  const previousFastReady = lastFastDeleteReady;

  state = await callRuntime<RuntimeState>({ type: "getRuntimeState" });
  const pageStatus = await callRuntime<{ isAlbumsPage: boolean }>({ type: "pageStatus" }).catch(() => ({ isAlbumsPage: false }));
  pageReady = pageStatus.isAlbumsPage;

  maybeToastStateChanges(previousPhase, previousMessage, previousFastReady);
  lastProgressPhase = state.progress.phase;
  lastProgressMessage = state.progress.message;
  lastFastDeleteReady = Boolean(state.settings.deleteRpc);

  render();
}

async function updateSettings(settings: Partial<StoredSettings>): Promise<void> {
  state.settings = await callRuntime<StoredSettings>({ type: "setSettings", settings });
  render();
}

function bindEvents(): void {
  document.querySelector<HTMLButtonElement>("#scanButton")?.addEventListener("click", async () => {
    try {
      showToast("Scanning", "Looking for empty albums…", "info", 2500);
      await callRuntime({ type: "scan", options: { includeShared: state.settings.includeShared } });
      await syncState();
    } catch (error) {
      showToast("Scan failed", error instanceof Error ? error.message : String(error), "error", 6500);
    }
  });

  document.querySelector<HTMLButtonElement>("#watchButton")?.addEventListener("click", async () => {
    try {
      const starting = !state.watching;
      await callRuntime({ type: starting ? "startWatch" : "stopWatch" });
      showToast(
        starting ? "Watching" : "Watch stopped",
        starting ? "Scroll the albums page — empty albums will be collected live." : "Collection paused. You can delete the albums found so far.",
        "info",
      );
      await syncState();
    } catch (error) {
      showToast("Watch failed", error instanceof Error ? error.message : String(error), "error");
    }
  });

  document.querySelector<HTMLButtonElement>("#refreshButton")?.addEventListener("click", async () => {
    await syncState();
    showToast("Refreshed", "Status and album list updated.", "info", 2200);
  });

  document.querySelector<HTMLButtonElement>("#openTabButton")?.addEventListener("click", async () => {
    await browser.tabs.create({ url: browser.runtime.getURL("popup.html") });
  });

  document.querySelector<HTMLButtonElement>("#cancelButton")?.addEventListener("click", async () => {
    await callRuntime({ type: "cancel" });
    showToast("Stopping", "Current deletion will stop after the album in progress.", "warn");
    await syncState();
  });

  document.querySelector<HTMLButtonElement>("#selectAllButton")?.addEventListener("click", () => {
    for (const album of state.albums) {
      selectedKeys.add(album.mediaKey);
    }
    render();
    showToast("Selected all", `${state.albums.length} album(s) selected.`, "info", 2200);
  });

  document.querySelector<HTMLButtonElement>("#selectNoneButton")?.addEventListener("click", () => {
    selectedKeys.clear();
    anchorIndex = null;
    render();
    showToast("Selection cleared", "No albums are selected for deletion.", "info", 2200);
  });

  document.querySelector<HTMLButtonElement>("#deleteButton")?.addEventListener("click", async () => {
    const albumMediaKeys = state.albums
      .filter((album) => selectedKeys.has(album.mediaKey))
      .map((album) => album.mediaKey);
    try {
      if (state.settings.dryRun) {
        showToast("Dry run", `Checking ${albumMediaKeys.length} selected album(s)…`, "info");
      } else if (!state.settings.deleteRpc) {
        showToast("Fast delete not ready", "Delete one empty album manually in Google Photos first.", "warn", 6500);
      } else {
        showToast("Starting deletion", `${albumMediaKeys.length} album(s) queued.`, "info");
      }
      await callRuntime({
        type: "delete",
        options: {
          albumMediaKeys,
          dryRun: state.settings.dryRun,
          includeShared: state.settings.includeShared,
        },
      });
      confirmText = "";
      await syncState();
    } catch (error) {
      showToast("Delete failed", error instanceof Error ? error.message : String(error), "error", 6500);
    }
  });

  document.querySelector<HTMLInputElement>("#includeShared")?.addEventListener("change", async (event) => {
    await updateSettings({ includeShared: (event.currentTarget as HTMLInputElement).checked });
  });

  document.querySelector<HTMLInputElement>("#dryRun")?.addEventListener("change", async (event) => {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    await updateSettings({ dryRun: enabled });
    showToast(enabled ? "Dry run on" : "Dry run off", enabled ? "Delete will only count albums." : "Delete will remove selected albums.", "info", 2500);
  });

  document.querySelector<HTMLButtonElement>("#themeToggle")?.addEventListener("click", async () => {
    const next = state.settings.theme === "light" ? "dark" : "light";
    await updateSettings({ theme: next });
    showToast(next === "light" ? "Light theme" : "Dark theme", "Theme preference saved.", "info", 1800);
  });

  document.querySelector<HTMLInputElement>("#batchSize")?.addEventListener("change", async (event) => {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    await updateSettings({ batchSize: Number.isFinite(value) && value > 0 ? Math.floor(value) : 25 });
  });

  document.querySelector<HTMLInputElement>("#pauseMs")?.addEventListener("change", async (event) => {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    await updateSettings({ pauseMs: Number.isFinite(value) && value >= 0 ? Math.floor(value) : 1500 });
  });

  document.querySelector<HTMLButtonElement>("#resumeButton")?.addEventListener("click", async () => {
    try {
      showToast("Resuming", `${state.pendingDeleteKeys.length} album(s) remaining.`, "info");
      await callRuntime({ type: "resume" });
      await syncState();
    } catch (error) {
      showToast("Resume failed", error instanceof Error ? error.message : String(error), "error");
    }
  });

  document.querySelector<HTMLInputElement>("#confirmInput")?.addEventListener("input", (event) => {
    confirmText = (event.currentTarget as HTMLInputElement).value;
    const deleteButton = document.querySelector<HTMLButtonElement>("#deleteButton");
    if (deleteButton) {
      deleteButton.disabled = !(confirmText === "DELETE" && selectedKeys.size > 0 && state.progress.phase !== "deleting");
    }
  });

  document.querySelectorAll<HTMLDivElement>(".album-item").forEach((row) => {
    row.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target instanceof HTMLInputElement) {
        return;
      }
      const index = Number(row.dataset.index ?? "-1");
      if (index >= 0) {
        applyRowSelection(index, event);
      }
    });
  });

  document.querySelectorAll<HTMLInputElement>(".selectCheckbox").forEach((checkbox) => {
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
      const index = Number((event.currentTarget as HTMLInputElement).dataset.index ?? "-1");
      if (index >= 0) {
        applyRowSelection(index, event as unknown as MouseEvent);
      }
    });
  });
}

async function bootstrap(): Promise<void> {
  state = await readRuntimeState();
  applyTheme(state.settings.theme ?? "dark");
  lastProgressPhase = state.progress.phase;
  lastProgressMessage = state.progress.message;
  lastFastDeleteReady = Boolean(state.settings.deleteRpc);
  await syncState();

  pollHandle = window.setInterval(async () => {
    if (state.watching || state.deleteInProgress || ["scanning", "deleting"].includes(state.progress.phase)) {
      await syncState();
    }
  }, 1000);

  browser.storage.onChanged.addListener((_changes, area) => {
    if (area !== "local") return;
    const typingConfirm = document.activeElement?.id === "confirmInput";
    if (typingConfirm || state.progress.phase === "deleting") return;
    void syncState();
  });
}

void bootstrap();
window.addEventListener("unload", () => {
  if (pollHandle) {
    window.clearInterval(pollHandle);
  }
});
