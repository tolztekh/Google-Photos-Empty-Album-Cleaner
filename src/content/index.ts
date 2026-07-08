import browser from "../lib/browser";
import { listEmptyAlbums } from "../lib/albums";
import { buildDeleteRpcSpec, deleteAlbums } from "../lib/deleter";
import { collectEmptyAlbumsOnce, scanEmptyAlbumsFromDom } from "../lib/dom";
import { installRpcCapture, readSessionTokens, type ObservedRpcRequest } from "../lib/session";
import { readRuntimeState, readSettings, writeRuntimeState, writeSettings } from "../lib/storage";
import type { AlbumRecord, ProgressState, RequestMessage, ScanOptions } from "../lib/types";

const observedRequests: ObservedRpcRequest[] = [];
let cancelRequested = false;

const watchAlbums = new Map<string, AlbumRecord>();
let watchHandle: number | undefined;

installRpcCapture((request) => {
  observedRequests.push(request);
  if (observedRequests.length > 60) {
    observedRequests.shift();
  }
  void tryLearnDeleteRpc();
});

let learnAttemptScheduled = false;

// When the user manually deletes an album, the page fires a batchexecute RPC.
// We watch for one whose payload contains a known album mediaKey and remember
// it as the delete template so every remaining album can be deleted the same
// fast way. This is version-proof: whatever rpcid Google currently uses, we
// learn it from the real request.
async function tryLearnDeleteRpc(): Promise<void> {
  if (learnAttemptScheduled) return;
  learnAttemptScheduled = true;
  try {
    const settings = await readSettings();
    if (settings.deleteRpc) return;
    const runtimeState = await readRuntimeState();
    if (runtimeState.albums.length === 0) return;
    const spec = buildDeleteRpcSpec(runtimeState.albums, observedRequests);
    if (spec) {
      await writeSettings({ deleteRpc: spec });
      await writeRuntimeState({
        settings: { deleteRpc: spec },
        progress: {
          ...runtimeState.progress,
          message: `Fast delete is ready (learned rpc ${spec.rpcid}). Select albums and delete.`,
        },
      });
    }
  } finally {
    learnAttemptScheduled = false;
  }
}

function isAlbumsPage(): boolean {
  return location.pathname.startsWith("/albums");
}

async function updateProgress(progress: Partial<ProgressState>): Promise<void> {
  await writeRuntimeState({ progress });
}

async function scanAlbums(options: ScanOptions) {
  await updateProgress({
    phase: "scanning",
    message: "Scanning albums...",
    total: 0,
    completed: 0,
    failures: [],
    cancelled: false,
  });

  try {
    const tokens = await readSessionTokens();
    const result = await listEmptyAlbums(tokens, options);
    await writeRuntimeState({
      albums: result.albums,
      scanSource: result.source,
      scanScannedCount: result.scannedCount,
      scanEmptyCount: result.albums.length,
      watching: false,
      progress: {
        phase: "confirm",
        message: `Found ${result.albums.length} empty of ${result.scannedCount} albums (fast API scan).`,
        total: result.albums.length,
        completed: 0,
        failures: [],
        cancelled: false,
      },
    });
    return result;
  } catch (error) {
    console.warn("Batched album scan failed, falling back to DOM scan", error);
    const domAlbums = await scanEmptyAlbumsFromDom(async (loadedCards, emptyFound) => {
      await updateProgress({
        phase: "scanning",
        message: `Loading albums by scrolling... ${loadedCards} loaded, ${emptyFound} empty so far.`,
        total: emptyFound,
        completed: 0,
        failures: [],
        cancelled: false,
      });
    });
    const result = {
      albums: domAlbums,
      source: "dom" as const,
      scannedCount: domAlbums.length,
      skippedSharedCount: 0,
    };
    await writeRuntimeState({
      albums: result.albums,
      scanSource: result.source,
      scanScannedCount: null,
      scanEmptyCount: result.albums.length,
      watching: false,
      progress: {
        phase: "confirm",
        message: `Found ${result.albums.length} empty albums (DOM scroll scan).`,
        total: result.albums.length,
        completed: 0,
        failures: [],
        cancelled: false,
      },
    });
    return result;
  }
}

async function collectWatchTick(): Promise<void> {
  for (const album of collectEmptyAlbumsOnce()) {
    if (!watchAlbums.has(album.mediaKey)) {
      watchAlbums.set(album.mediaKey, album);
    }
  }

  const albums = [...watchAlbums.values()].sort((left, right) => left.title.localeCompare(right.title));
  await writeRuntimeState({
    albums,
    scanSource: "dom",
    scanScannedCount: null,
    scanEmptyCount: albums.length,
    watching: true,
    progress: {
      phase: "scanning",
      message: `Watching - scroll the albums page. ${albums.length} empty found so far.`,
      total: albums.length,
      completed: 0,
      failures: [],
      cancelled: false,
    },
  });
}

async function startWatch(): Promise<void> {
  const runtimeState = await readRuntimeState();
  watchAlbums.clear();
  for (const album of runtimeState.albums) {
    watchAlbums.set(album.mediaKey, album);
  }

  if (watchHandle) {
    window.clearInterval(watchHandle);
  }
  await collectWatchTick();
  watchHandle = window.setInterval(() => {
    void collectWatchTick();
  }, 700);
}

async function stopWatch(): Promise<void> {
  if (watchHandle) {
    window.clearInterval(watchHandle);
    watchHandle = undefined;
  }
  const albums = [...watchAlbums.values()].sort((left, right) => left.title.localeCompare(right.title));
  await writeRuntimeState({
    albums,
    scanSource: "dom",
    scanEmptyCount: albums.length,
    watching: false,
    progress: {
      phase: "confirm",
      message: `Watch stopped. ${albums.length} empty albums collected.`,
      total: albums.length,
      completed: 0,
      failures: [],
      cancelled: false,
    },
  });
}

async function runDelete(albumMediaKeys: string[], dryRun: boolean, includeShared: boolean) {
  if (watchHandle) {
    window.clearInterval(watchHandle);
    watchHandle = undefined;
  }
  cancelRequested = false;
  const runtimeState = await readRuntimeState();
  const settings = await readSettings();
  const albumsByKey = new Map(runtimeState.albums.map((album) => [album.mediaKey, album]));
  const albums = albumMediaKeys
    .map((key) => albumsByKey.get(key))
    .filter((album): album is AlbumRecord => Boolean(album))
    .filter((album) => includeShared || !album.isShared);

  if (dryRun) {
    await writeRuntimeState({
      progress: {
        phase: "confirm",
        message: `Dry run: ${albums.length} album(s) would be deleted. Uncheck "Dry run only" to delete for real.`,
        total: albums.length,
        completed: 0,
        failures: [],
        cancelled: false,
      },
    });
    return { deletedCount: 0, source: "dry-run" as const };
  }

  const spec = settings.deleteRpc ?? buildDeleteRpcSpec(albums, observedRequests);
  if (!spec) {
    await writeRuntimeState({
      deleteInProgress: false,
      progress: {
        phase: "error",
        message:
          'Fast delete not ready. Open ONE empty album on the page and click "Delete album" once. ' +
          "The extension will learn the delete action, then click Delete here to remove the rest automatically.",
        total: albums.length,
        completed: 0,
        failures: [],
        cancelled: false,
      },
    });
    return { deletedCount: 0, source: "dry-run" as const };
  }

  await writeRuntimeState({
    deleteInProgress: true,
    deletedThisRun: 0,
    pendingDeleteKeys: albums.map((album) => album.mediaKey),
    progress: {
      phase: "deleting",
      message: `Deleting ${albums.length} empty albums...`,
      total: albums.length,
      completed: 0,
      currentAlbumTitle: undefined,
      failures: [],
      cancelled: false,
    },
  });

  const tokens = await readSessionTokens();
  const result = await deleteAlbums({
    albums,
    tokens,
    dryRun: false,
    batchSize: settings.batchSize,
    pauseMs: settings.pauseMs,
    learnedSpec: spec,
    observedRequests,
    shouldCancel: () => cancelRequested,
    onProgress: async (info) => {
      await writeRuntimeState({
        pendingDeleteKeys: info.remainingKeys,
        deletedThisRun: info.deleted,
        progress: {
          phase: "deleting",
          message: `Deleting via ${info.source}... ${info.deleted} deleted, ${info.failures.length} failed. batch ${settings.batchSize}, pause ${settings.pauseMs}ms.`,
          total: albums.length,
          completed: info.processed,
          currentAlbumTitle: info.currentTitle,
          failures: info.failures,
          cancelled: cancelRequested,
        },
      });
    },
  });

  if (result.learnedSpec && !settings.deleteRpc) {
    await writeSettings({ deleteRpc: result.learnedSpec });
  }

  const deletedKeys = new Set(albums.slice(0, result.deletedCount).map((album) => album.mediaKey));
  const remainingAlbums = runtimeState.albums.filter((album) => !deletedKeys.has(album.mediaKey));

  await writeRuntimeState({
    albums: remainingAlbums,
    lastDeleteSource: result.source,
    deleteInProgress: false,
    pendingDeleteKeys: cancelRequested
      ? albums.slice(result.deletedCount + result.failures.length).map((album) => album.mediaKey)
      : [],
    scanEmptyCount: remainingAlbums.length,
    progress: {
      phase: result.failures.length > 0 ? "error" : "done",
      message: cancelRequested
        ? `Stopped after deleting ${result.deletedCount} album(s). ${remainingAlbums.length} empty remaining.`
        : `Deleted ${result.deletedCount} album(s) via ${result.source}. ${result.failures.length} failed.`,
      total: albums.length,
      completed: result.deletedCount,
      failures: result.failures,
      cancelled: cancelRequested,
    },
  });

  return result;
}

async function resumeDelete() {
  const runtimeState = await readRuntimeState();
  if (runtimeState.pendingDeleteKeys.length === 0) {
    return { deletedCount: 0, source: "dry-run" as const };
  }
  return await runDelete(runtimeState.pendingDeleteKeys, false, runtimeState.settings.includeShared);
}

browser.runtime.onMessage.addListener((message: RequestMessage) => {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return;
  }

  switch (message.type) {
    case "pageStatus":
      return Promise.resolve({ ok: true, result: { isAlbumsPage: isAlbumsPage() } });
    case "scan":
      return scanAlbums(message.options).then((result) => ({ ok: true, result })).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    case "delete":
      return runDelete(message.options.albumMediaKeys, message.options.dryRun, message.options.includeShared)
        .then((result) => ({ ok: true, result }))
        .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    case "resume":
      return resumeDelete().then((result) => ({ ok: true, result })).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    case "cancel":
      cancelRequested = true;
      return Promise.resolve({ ok: true, result: true });
    case "startWatch":
      return startWatch().then(() => ({ ok: true, result: true })).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    case "stopWatch":
      return stopWatch().then(() => ({ ok: true, result: true })).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    default:
      return Promise.resolve({ ok: false, error: `Unsupported message: ${String((message as { type: string }).type)}` });
  }
});
