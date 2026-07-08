import type { SessionTokens } from "./types";

let reqIdCounter = Math.floor(Math.random() * 100000) + 100000;

async function doRequest(url: string, body: URLSearchParams): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Google Photos request failed: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

function buildUrl(tokens: SessionTokens, rpcid: string, sourcePath: string): string {
  const params = new URLSearchParams({
    rpcids: rpcid,
    "source-path": sourcePath,
    "f.sid": tokens.fSid,
    bl: tokens.bl,
    pageId: "none",
    rt: "c",
    _reqid: String(reqIdCounter++),
  });

  if (tokens.rapt) {
    params.set("rapt", tokens.rapt);
  }

  return `https://photos.google.com${tokens.path}data/batchexecute?${params.toString()}`;
}

function parseResponse<T>(text: string): T {
  const payloadLine = text.split("\n").find((line) => line.includes("wrb.fr"));
  if (!payloadLine) {
    throw new Error("Google Photos response did not contain a batchexecute payload.");
  }

  const parsed = JSON.parse(payloadLine);
  const rawPayload = parsed?.[0]?.[2];
  if (!rawPayload) {
    throw new Error("Google Photos response payload was empty.");
  }

  return JSON.parse(rawPayload) as T;
}

export async function makeBatchedRequest<T>(
  tokens: SessionTokens,
  rpcid: string,
  requestData: unknown,
  sourcePath = window.location.pathname,
): Promise<T> {
  const wrapped = [[[rpcid, JSON.stringify(requestData), null, "generic"]]];
  const body = new URLSearchParams({
    "f.req": JSON.stringify(wrapped),
    at: tokens.at,
  });

  const text = await doRequest(buildUrl(tokens, rpcid, sourcePath), body);
  return parseResponse<T>(text);
}

export async function makeRawBatchedRequest<T>(
  tokens: SessionTokens,
  rpcid: string,
  rawFReq: string,
  sourcePath = window.location.pathname,
): Promise<T> {
  const body = new URLSearchParams({
    "f.req": rawFReq,
    at: tokens.at,
  });

  const text = await doRequest(buildUrl(tokens, rpcid, sourcePath), body);
  return parseResponse<T>(text);
}
