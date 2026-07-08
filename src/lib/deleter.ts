import { makeRawBatchedRequest } from "./batchexecute";
import { deleteAlbumFromDom, sleep } from "./dom";
import type { AlbumRecord, DeleteFailure, DeleteResult, DeleteRpcSpec, SessionTokens } from "./types";
import type { ObservedRpcRequest } from "./session";

const PLACEHOLDER = "__ALBUM_KEY__";

export function buildDeleteRpcSpec(albums: AlbumRecord[], observedRequests: ObservedRpcRequest[]): DeleteRpcSpec | null {
  const recent = [...observedRequests].reverse();

  for (const request of recent) {
    if (!request.rpcids || request.rpcids === "Z5xsfc") continue;
    const params = new URLSearchParams(request.body);
    const rawFReq = params.get("f.req");
    if (!rawFReq) continue;

    for (const album of albums) {
      if (!album.mediaKey || !rawFReq.includes(album.mediaKey)) continue;
      return {
        rpcid: request.rpcids.split(",")[0],
        template: rawFReq.split(album.mediaKey).join(PLACEHOLDER),
      };
    }
  }

  return null;
}

async function deleteAlbumWithRpc(tokens: SessionTokens, spec: DeleteRpcSpec, album: AlbumRecord): Promise<void> {
  const rawFReq = spec.template.replace(new RegExp(PLACEHOLDER, "g"), album.mediaKey);
  await makeRawBatchedRequest(tokens, spec.rpcid, rawFReq);
}

export interface DeleteProgressInfo {
  processed: number;
  deleted: number;
  currentTitle: string;
  remainingKeys: string[];
  failures: DeleteFailure[];
  source: DeleteResult["source"];
}

export interface DeleteRunConfig {
  albums: AlbumRecord[];
  tokens: SessionTokens;
  dryRun: boolean;
  batchSize: number;
  pauseMs: number;
  learnedSpec: DeleteRpcSpec | null;
  observedRequests: ObservedRpcRequest[];
  shouldCancel: () => boolean;
  onProgress: (info: DeleteProgressInfo) => Promise<void> | void;
}

export interface DeleteRunResult extends DeleteResult {
  learnedSpec: DeleteRpcSpec | null;
}

export async function deleteAlbums(config: DeleteRunConfig): Promise<DeleteRunResult> {
  const { albums, tokens, dryRun, batchSize, pauseMs, observedRequests, shouldCancel, onProgress } = config;

  if (dryRun) {
    return {
      source: "dry-run",
      deletedCount: 0,
      skippedCount: albums.length,
      failures: [],
      learnedSpec: config.learnedSpec,
    };
  }

  const failures: DeleteFailure[] = [];
  let deletedCount = 0;
  let processed = 0;
  let usedRpc = false;
  let usedDom = false;

  const spec = config.learnedSpec ?? buildDeleteRpcSpec(albums, observedRequests);
  const effectiveBatchSize = Math.max(1, batchSize);

  for (let index = 0; index < albums.length; index += 1) {
    if (shouldCancel()) {
      break;
    }

    const album = albums[index];

    try {
      if (spec) {
        try {
          await deleteAlbumWithRpc(tokens, spec, album);
          usedRpc = true;
        } catch (rpcError) {
          console.warn("Delete RPC failed, falling back to DOM", rpcError);
          await deleteAlbumFromDom(album.title);
          usedDom = true;
        }
      } else {
        await deleteAlbumFromDom(album.title);
        usedDom = true;
      }
      deletedCount += 1;
    } catch (error) {
      failures.push({
        albumMediaKey: album.mediaKey,
        title: album.title,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    processed += 1;
    const remainingKeys = albums.slice(index + 1).map((item) => item.mediaKey);
    const source: DeleteResult["source"] = usedRpc && usedDom ? "mixed" : usedRpc ? "rpc" : "dom";
    await onProgress({ processed, deleted: deletedCount, currentTitle: album.title, remainingKeys, failures, source });

    const isBatchBoundary = processed % effectiveBatchSize === 0;
    if (isBatchBoundary && index < albums.length - 1 && pauseMs > 0 && !shouldCancel()) {
      await sleep(pauseMs);
    } else if (spec) {
      // Small delay between RPC deletes to avoid rate limiting.
      await sleep(250);
    }
  }

  return {
    source: usedRpc && usedDom ? "mixed" : usedRpc ? "rpc" : usedDom ? "dom" : "dom",
    deletedCount,
    skippedCount: albums.length - deletedCount - failures.length,
    failures,
    learnedSpec: spec,
  };
}
