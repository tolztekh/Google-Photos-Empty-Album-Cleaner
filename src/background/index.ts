import browser from "../lib/browser";
import { defaultRuntimeState, readRuntimeState, readSettings, writeRuntimeState, writeSettings } from "../lib/storage";
import type { RequestMessage } from "../lib/types";

async function getActiveAlbumsTabId(): Promise<number> {
  const photosTabs = await browser.tabs.query({
    url: ["https://photos.google.com/albums*"],
    lastFocusedWindow: true,
  });

  const activePhotosTab = photosTabs.find((tab) => tab.active) ?? photosTabs[0];
  if (activePhotosTab?.id) {
    return activePhotosTab.id;
  }

  const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = tabs[0];
  if (!activeTab?.id) {
    throw new Error("Could not locate the active Google Photos albums tab.");
  }
  return activeTab.id;
}

async function sendToActiveTab(message: RequestMessage) {
  const tabId = await getActiveAlbumsTabId();
  return await browser.tabs.sendMessage(tabId, message);
}

browser.runtime.onInstalled.addListener(async () => {
  const settings = await readSettings();
  await writeRuntimeState({ ...defaultRuntimeState, settings });
});

const globalApi = browser as unknown as {
  sidePanel?: { setPanelBehavior?: (options: { openPanelOnActionClick: boolean }) => Promise<void> };
  sidebarAction?: { toggle?: () => Promise<void> };
};

if (globalApi.sidePanel?.setPanelBehavior) {
  globalApi.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.warn("Could not enable side panel behavior", error));
} else if (globalApi.sidebarAction?.toggle) {
  browser.action.onClicked.addListener(() => {
    void globalApi.sidebarAction?.toggle?.();
  });
}

browser.runtime.onMessage.addListener((message: RequestMessage) => {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return;
  }

  switch (message.type) {
    case "getRuntimeState":
      return readRuntimeState().then((state) => ({ ok: true, result: state }));
    case "setSettings":
      return writeSettings(message.settings).then(async (settings) => {
        await writeRuntimeState({ settings });
        return { ok: true, result: settings };
      });
    case "scan":
    case "delete":
    case "resume":
    case "cancel":
    case "startWatch":
    case "stopWatch":
    case "pageStatus":
      return sendToActiveTab(message).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    default:
      return Promise.resolve({ ok: false, error: `Unsupported message: ${String((message as { type: string }).type)}` });
  }
});
