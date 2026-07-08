export interface SessionTokens {
  at: string;
  fSid: string;
  bl: string;
  path: string;
  account?: string;
  rapt?: string;
}

export interface AlbumRecord {
  mediaKey: string;
  title: string;
  itemCount: number;
  creationTimestamp: number | null;
  modifiedTimestamp: number | null;
  isShared: boolean;
  authKey?: string;
}

export interface ScanOptions {
  includeShared: boolean;
}

export interface ScanResult {
  albums: AlbumRecord[];
  source: "batchexecute" | "dom";
  scannedCount: number;
  skippedSharedCount: number;
}

export interface DeleteOptions {
  albumMediaKeys: string[];
  dryRun: boolean;
  includeShared: boolean;
}

export interface DeleteFailure {
  albumMediaKey: string;
  title: string;
  reason: string;
}

export interface DeleteResult {
  source: "rpc" | "dom" | "mixed" | "dry-run";
  deletedCount: number;
  skippedCount: number;
  failures: DeleteFailure[];
}

export interface ProgressState {
  phase: "idle" | "scanning" | "confirm" | "deleting" | "done" | "error";
  message: string;
  total: number;
  completed: number;
  currentAlbumTitle?: string;
  failures: DeleteFailure[];
  cancelled: boolean;
}

export interface DeleteRpcSpec {
  rpcid: string;
  template: string;
}

export interface StoredSettings {
  includeShared: boolean;
  dryRun: boolean;
  excludedAlbumKeys: string[];
  batchSize: number;
  pauseMs: number;
  deleteRpc: DeleteRpcSpec | null;
}

export interface RuntimeState {
  albums: AlbumRecord[];
  scanSource: ScanResult["source"] | null;
  scanScannedCount: number | null;
  scanEmptyCount: number | null;
  watching: boolean;
  pendingDeleteKeys: string[];
  deleteInProgress: boolean;
  deletedThisRun: number;
  progress: ProgressState;
  settings: StoredSettings;
  lastDeleteSource: DeleteResult["source"] | null;
}

export type RequestMessage =
  | { type: "scan"; options: ScanOptions }
  | { type: "delete"; options: DeleteOptions }
  | { type: "resume" }
  | { type: "cancel" }
  | { type: "startWatch" }
  | { type: "stopWatch" }
  | { type: "pageStatus" }
  | { type: "getRuntimeState" }
  | { type: "setSettings"; settings: Partial<StoredSettings> };

export type ResponseMessage =
  | { ok: true; result?: unknown }
  | { ok: false; error: string };
