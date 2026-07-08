import type { SessionTokens } from "./types";

const CHANNEL = "gpeac";
const SESSION_REQUEST = "gpeac:getSession";
const SESSION_RESULT = "gpeac:session";
const RPC_EVENT = "gpeac:rpc";

export interface ObservedRpcRequest {
  rpcids: string;
  body: string;
  url: string;
  timestamp: number;
}

interface ChannelMessage {
  channel?: string;
  type?: string;
  detail?: unknown;
}

// The MAIN-world page script (page.js) reads Google Photos' page globals and
// hooks fetch/XHR, then relays everything here via window.postMessage. This
// avoids injecting inline scripts, which the page CSP blocks.
const ORIGIN = window.location.origin;

export async function readSessionTokens(): Promise<SessionTokens> {
  return await new Promise<SessionTokens>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Timed out while reading Google Photos session tokens."));
    }, 5000);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== ORIGIN) return;
      const data = event.data as ChannelMessage | undefined;
      if (!data || data.channel !== CHANNEL || data.type !== SESSION_RESULT) return;

      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);

      const tokens = data.detail as Partial<SessionTokens> | undefined;
      if (!tokens?.at || !tokens?.fSid || !tokens?.bl || !tokens?.path) {
        reject(new Error("Google Photos session tokens were unavailable on this page."));
        return;
      }
      resolve(tokens as SessionTokens);
    };

    window.addEventListener("message", onMessage);
    window.postMessage({ channel: CHANNEL, type: SESSION_REQUEST }, ORIGIN);
  });
}

export function installRpcCapture(onRequest: (request: ObservedRpcRequest) => void): void {
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const data = event.data as ChannelMessage | undefined;
    if (!data || data.channel !== CHANNEL || data.type !== RPC_EVENT) return;
    onRequest(data.detail as ObservedRpcRequest);
  });
}
