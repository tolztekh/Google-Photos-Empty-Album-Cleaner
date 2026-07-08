import { makeBatchedRequest } from "./batchexecute";
import type { AlbumRecord, ScanOptions, ScanResult, SessionTokens } from "./types";

const ALBUM_RPC = "Z5xsfc";

function parseAlbum(itemData: any): AlbumRecord {
  const meta = itemData?.at(-1)?.[72930366] ?? {};
  const timestamps = meta?.[2] ?? {};
  return {
    mediaKey: itemData?.[0],
    title: meta?.[1] ?? "Untitled album",
    itemCount: Number(meta?.[3] ?? 0),
    creationTimestamp: timestamps?.[4] ?? null,
    modifiedTimestamp: timestamps?.[9] ?? null,
    isShared: Boolean(meta?.[4]),
    authKey: meta?.[5] ?? undefined,
  };
}

async function getAlbumPage(tokens: SessionTokens, pageId: string | null): Promise<{ items: AlbumRecord[]; nextPageId: string | null }> {
  const requestData = [pageId, null, null, null, 1, null, null, 100, [2], 5];
  const response = await makeBatchedRequest<any>(tokens, ALBUM_RPC, requestData);
  return {
    items: (response?.[0] ?? []).map((item: any) => parseAlbum(item)).filter((album: AlbumRecord) => Boolean(album.mediaKey)),
    nextPageId: response?.[1] ?? null,
  };
}

export async function listEmptyAlbums(tokens: SessionTokens, options: ScanOptions): Promise<ScanResult> {
  const albums: AlbumRecord[] = [];
  const seenAlbumKeys = new Set<string>();
  const seenPageIds = new Set<string>();
  let pageId: string | null = null;
  let scannedCount = 0;
  let skippedSharedCount = 0;

  for (let page = 0; page < 500; page += 1) {
    const result = await getAlbumPage(tokens, pageId);

    for (const album of result.items) {
      if (seenAlbumKeys.has(album.mediaKey)) {
        continue;
      }
      seenAlbumKeys.add(album.mediaKey);
      scannedCount += 1;

      if (album.isShared && !options.includeShared) {
        skippedSharedCount += 1;
        continue;
      }
      if (album.itemCount === 0) {
        albums.push(album);
      }
    }

    const nextPageId = result.nextPageId;
    if (!nextPageId || seenPageIds.has(nextPageId)) {
      break;
    }
    seenPageIds.add(nextPageId);
    pageId = nextPageId;
  }

  albums.sort((left, right) => left.title.localeCompare(right.title));

  return {
    albums,
    source: "batchexecute",
    scannedCount,
    skippedSharedCount,
  };
}
