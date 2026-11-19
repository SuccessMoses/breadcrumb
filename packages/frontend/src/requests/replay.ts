import { normalizeRaw } from "shared";

import type { FrontendSDK } from "@/types";

const HOST_HEADER = /^host:\s*(.+)$/im;
const HOST_AND_PORT = /^(.+?)(?::(\d+))?$/;
const DEFAULT_PORT = 443;
const PLAIN_PORT = 80;

// Where a request goes, read from its Host header. Port 80 is plain HTTP and
// any other port is sent over TLS, since the scheme is not stored with a step.
const connectionOf = (raw: string) => {
  const value = HOST_HEADER.exec(raw)?.[1]?.trim();
  if (value === undefined || value === "") return undefined;
  const parts = HOST_AND_PORT.exec(value);
  if (parts === null) return undefined;
  const port = parts[2] === undefined ? DEFAULT_PORT : Number(parts[2]);
  return { host: parts[1] ?? value, port, isTLS: port !== PLAIN_PORT };
};

// Creates a Replay session holding the request and opens it in a new tab.
// Returns an error message, or undefined on success.
export const sendToReplay = async (
  sdk: FrontendSDK,
  raw: string,
): Promise<string | undefined> => {
  const connectionInfo = connectionOf(raw);
  if (connectionInfo === undefined) return "Request has no Host header";

  const before = new Set(sdk.replay.getSessions().map((session) => session.id));
  try {
    await sdk.replay.createSession({
      type: "Raw",
      raw: normalizeRaw(raw),
      connectionInfo,
    });
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }

  const created = sdk.replay.getSessions().find((s) => !before.has(s.id));
  if (created !== undefined) sdk.replay.openTab(created.id);
  return undefined;
};
