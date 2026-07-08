// Runs in the MAIN world (page context) so it can read Google Photos' page
// globals and observe its network calls. It never injects inline scripts, so
// it does not violate the page Content Security Policy. It talks to the
// isolated content script exclusively via window.postMessage.

const CHANNEL = "gpeac";
const SESSION_REQUEST = "gpeac:getSession";
const SESSION_RESULT = "gpeac:session";
const RPC_EVENT = "gpeac:rpc";

interface PageWindow extends Window {
  WIZ_global_data?: Record<string, unknown>;
  __gpeacHooked?: boolean;
}

const pageWindow = window as PageWindow;

function readTokens() {
  const data = pageWindow.WIZ_global_data ?? {};
  return {
    at: data.SNlM0e as string | undefined,
    fSid: data.FdrFJe as string | undefined,
    bl: data.cfb2h as string | undefined,
    path: data.eptZe as string | undefined,
    account: data.oPEP7c as string | undefined,
    rapt: data.Dbw5Ud as string | undefined,
  };
}

// Only ever exchange messages within this exact page origin. This keeps the
// session tokens and captured requests from being posted to (or accepted from)
// any other frame/origin.
const ORIGIN = window.location.origin;

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== ORIGIN) return;
  const data = event.data as { channel?: string; type?: string } | undefined;
  if (!data || data.channel !== CHANNEL || data.type !== SESSION_REQUEST) return;
  window.postMessage({ channel: CHANNEL, type: SESSION_RESULT, detail: readTokens() }, ORIGIN);
});

function emitRpc(url: unknown, body: unknown): void {
  try {
    const urlString = String(url ?? "");
    if (!urlString.includes("/batchexecute")) return;
    const rpcids = new URL(urlString, location.origin).searchParams.get("rpcids") ?? "";
    window.postMessage(
      {
        channel: CHANNEL,
        type: RPC_EVENT,
        detail: {
          rpcids,
          url: urlString,
          body: typeof body === "string" ? body : String(body ?? ""),
          timestamp: Date.now(),
        },
      },
      ORIGIN,
    );
  } catch {
    // Ignore malformed requests.
  }
}

if (!pageWindow.__gpeacHooked) {
  pageWindow.__gpeacHooked = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = ((...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const url = typeof input === "string" ? input : (input as Request)?.url;
    const body = init?.body ?? (typeof input === "object" ? (input as Request)?.body : undefined);
    emitRpc(url, body);
    return originalFetch(...args);
  }) as typeof fetch;

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { __gpeacUrl?: string }, method: string, url: string | URL, ...rest: unknown[]) {
    this.__gpeacUrl = String(url);
    // eslint-disable-next-line prefer-rest-params
    return originalOpen.apply(this, arguments as unknown as Parameters<typeof originalOpen>);
  } as typeof XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest & { __gpeacUrl?: string }, body?: Document | XMLHttpRequestBodyInit | null) {
    emitRpc(this.__gpeacUrl, body);
    return originalSend.apply(this, arguments as unknown as Parameters<typeof originalSend>);
  } as typeof XMLHttpRequest.prototype.send;
}
