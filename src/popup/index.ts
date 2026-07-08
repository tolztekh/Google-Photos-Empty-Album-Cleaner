import browser from "../lib/browser";
import { readRuntimeState } from "../lib/storage";
import type { AlbumRecord, RuntimeState, StoredSettings } from "../lib/types";

const rootElement = document.querySelector<HTMLDivElement>("#app");
if (!rootElement) {
  throw new Error("Popup root was not found.");
}
const root = rootElement;

let state: RuntimeState;
let pageReady = false;
let confirmText = "";
let pollHandle: number | undefined;

const selectedKeys = new Set<string>();
let albumsSignature = "";
let anchorIndex: number | null = null;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
    // Drop any keys that no longer exist (e.g. after deletion).
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

function render(): void {
  syncSelectionWithAlbums();

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

  root.innerHTML = `
    <div class="panel">
      <div class="card stack">
        <div>
          <div class="row"><strong>Google Photos Empty Album Cleaner</strong><span class="badge">${escapeHtml(state.scanSource ?? "idle")}</span></div>
          <div class="small">Select empty albums, then delete the ones you choose.</div>
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
    </div>
  `;

  bindEvents();
}

async function syncState(): Promise<void> {
  state = await callRuntime<RuntimeState>({ type: "getRuntimeState" });
  const pageStatus = await callRuntime<{ isAlbumsPage: boolean }>({ type: "pageStatus" }).catch(() => ({ isAlbumsPage: false }));
  pageReady = pageStatus.isAlbumsPage;
  render();
}

async function updateSettings(settings: Partial<StoredSettings>): Promise<void> {
  state.settings = await callRuntime<StoredSettings>({ type: "setSettings", settings });
  render();
}

function bindEvents(): void {
  document.querySelector<HTMLButtonElement>("#scanButton")?.addEventListener("click", async () => {
    await callRuntime({ type: "scan", options: { includeShared: state.settings.includeShared } });
    await syncState();
  });

  document.querySelector<HTMLButtonElement>("#watchButton")?.addEventListener("click", async () => {
    await callRuntime({ type: state.watching ? "stopWatch" : "startWatch" });
    await syncState();
  });

  document.querySelector<HTMLButtonElement>("#refreshButton")?.addEventListener("click", async () => {
    await syncState();
  });

  document.querySelector<HTMLButtonElement>("#openTabButton")?.addEventListener("click", async () => {
    await browser.tabs.create({ url: browser.runtime.getURL("popup.html") });
  });

  document.querySelector<HTMLButtonElement>("#cancelButton")?.addEventListener("click", async () => {
    await callRuntime({ type: "cancel" });
    await syncState();
  });

  document.querySelector<HTMLButtonElement>("#selectAllButton")?.addEventListener("click", () => {
    for (const album of state.albums) {
      selectedKeys.add(album.mediaKey);
    }
    render();
  });

  document.querySelector<HTMLButtonElement>("#selectNoneButton")?.addEventListener("click", () => {
    selectedKeys.clear();
    anchorIndex = null;
    render();
  });

  document.querySelector<HTMLButtonElement>("#deleteButton")?.addEventListener("click", async () => {
    const albumMediaKeys = state.albums
      .filter((album) => selectedKeys.has(album.mediaKey))
      .map((album) => album.mediaKey);
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
  });

  document.querySelector<HTMLInputElement>("#includeShared")?.addEventListener("change", async (event) => {
    await updateSettings({ includeShared: (event.currentTarget as HTMLInputElement).checked });
  });

  document.querySelector<HTMLInputElement>("#dryRun")?.addEventListener("change", async (event) => {
    await updateSettings({ dryRun: (event.currentTarget as HTMLInputElement).checked });
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
    await callRuntime({ type: "resume" });
    await syncState();
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
  await syncState();

  pollHandle = window.setInterval(async () => {
    if (state.watching || state.deleteInProgress || ["scanning", "deleting"].includes(state.progress.phase)) {
      await syncState();
    }
  }, 1000);

  // React to the content script learning the delete RPC (or any state change)
  // without constantly polling, so the "fast delete ready" status flips live.
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
