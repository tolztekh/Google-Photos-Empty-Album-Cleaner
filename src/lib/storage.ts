import browser from "./browser";
import type { RuntimeState, StoredSettings } from "./types";

const SETTINGS_KEY = "settings";
const STATE_KEY = "runtimeState";

type RuntimeStatePatch = Partial<Omit<RuntimeState, "progress" | "settings">> & {
  progress?: Partial<RuntimeState["progress"]>;
  settings?: Partial<RuntimeState["settings"]>;
};

export const defaultSettings: StoredSettings = {
  includeShared: false,
  dryRun: false,
  excludedAlbumKeys: [],
  batchSize: 25,
  pauseMs: 1500,
  theme: "dark",
  deleteRpc: null,
};

export const defaultRuntimeState: RuntimeState = {
  albums: [],
  scanSource: null,
  scanScannedCount: null,
  scanEmptyCount: null,
  watching: false,
  pendingDeleteKeys: [],
  deleteInProgress: false,
  deletedThisRun: 0,
  progress: {
    phase: "idle",
    message: "Ready",
    total: 0,
    completed: 0,
    failures: [],
    cancelled: false,
  },
  settings: defaultSettings,
  lastDeleteSource: null,
};

export async function readSettings(): Promise<StoredSettings> {
  const values = await browser.storage.local.get(SETTINGS_KEY);
  return { ...defaultSettings, ...(values[SETTINGS_KEY] as Partial<StoredSettings> | undefined) };
}

export async function writeSettings(settings: Partial<StoredSettings>): Promise<StoredSettings> {
  const next = { ...(await readSettings()), ...settings };
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function readRuntimeState(): Promise<RuntimeState> {
  const values = await browser.storage.local.get(STATE_KEY);
  return { ...defaultRuntimeState, ...(values[STATE_KEY] as Partial<RuntimeState> | undefined) };
}

export async function writeRuntimeState(state: RuntimeStatePatch): Promise<RuntimeState> {
  const current = await readRuntimeState();
  const next: RuntimeState = {
    ...current,
    ...state,
    progress: {
      ...current.progress,
      ...(state.progress ?? {}),
    },
    settings: {
      ...current.settings,
      ...(state.settings ?? {}),
    },
  };
  await browser.storage.local.set({ [STATE_KEY]: next });
  return next;
}
