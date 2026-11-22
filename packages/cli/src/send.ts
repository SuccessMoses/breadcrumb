/* eslint-disable compat/compat -- the CLI runs on Node, not in a browser */
import { connect as connectPlain, type Socket } from "node:net";
import { clearTimeout, setTimeout } from "node:timers";
import { connect as connectTls } from "node:tls";

import type { SendResult } from "@caido-community/breadcrumb-core";
import { normalizeRaw, requestBytes, UPLOAD_START } from "shared";

export type SendOptions = {
  // Accept certificates that do not verify, such as a local self-signed one
  insecure: boolean;
  // Forces TLS on or off; by default port 443 and ports not given use TLS
  tls?: boolean;
  timeoutMs?: number;
};

type Target = { host: string; port: number; tls: boolean };

// Where a raw request goes, from its Host header
const targetOf = (raw: string, tls?: boolean): Target | undefined => {
  const value = /^host:[ \t]*(\S+)/im.exec(raw)?.[1];
  if (value === undefined) return undefined;
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(value);
  if (match === null) return undefined;
  const host = (match[1] ?? "").replace(/^\[|\]$/g, "");
  const explicit = match[2] === undefined ? undefined : Number(match[2]);
  const useTls = tls ?? (explicit === undefined || explicit === 443);
  return { host, port: explicit ?? (useTls ? 443 : 80), tls: useTls };
};

// Whether the response read so far is complete, so the connection can be closed
const isComplete = (text: string): boolean => {
  const end = text.indexOf("\r\n\r\n");
  if (end === -1) return false;
  const head = text.slice(0, end);
  const body = text.slice(end + 4);
  if (/^HTTP\/1\.\d (204|304)/.test(head)) return true;
  const length = /^content-length:[ \t]*(\d+)/im.exec(head)?.[1];
  if (length !== undefined) return Buffer.byteLength(body) >= Number(length);
  if (/^transfer-encoding:.*chunked/im.test(head)) {
    return body.endsWith("0\r\n\r\n");
  }
  return false;
};

// Sends a raw request over its own connection and returns the raw response. The
// request is sent as written, with the same repairs the plugin makes.
export const sendRaw = (
  raw: string,
  options: SendOptions,
): Promise<SendResult> => {
  const target = targetOf(raw, options.tls);
  if (target === undefined) {
    return Promise.resolve({
      kind: "Error",
      error: "The request has no Host header",
    });
  }
  const lined = raw.replace(/\r?\n/g, "\r\n");
  const wire = lined.includes(UPLOAD_START)
    ? Buffer.from(requestBytes(lined))
    : Buffer.from(normalizeRaw(lined), "utf8");

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let settled = false;
    let quiet: NodeJS.Timeout | undefined;
    const socket: Socket = target.tls
      ? connectTls({
          host: target.host,
          port: target.port,
          servername: target.host,
          rejectUnauthorized: !options.insecure,
        })
      : connectPlain({ host: target.host, port: target.port });

    const finish = (result: SendResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(quiet);
      clearTimeout(overall);
      socket.destroy();
      resolve(result);
    };
    const received = () => Buffer.concat(chunks).toString("utf8");

    const overall = setTimeout(() => {
      const data = received();
      finish(
        data === ""
          ? { kind: "Error", error: "Timed out" }
          : { kind: "Ok", value: data },
      );
    }, options.timeoutMs ?? 15000);

    socket.on("connect", () => socket.write(wire));
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      const data = received();
      if (isComplete(data)) {
        finish({ kind: "Ok", value: data });
        return;
      }
      // Without a length the body ends when the server closes or goes quiet
      clearTimeout(quiet);
      quiet = setTimeout(() => finish({ kind: "Ok", value: received() }), 1500);
    });
    socket.on("end", () => {
      const data = received();
      finish(
        data === ""
          ? { kind: "Error", error: "The connection closed" }
          : { kind: "Ok", value: data },
      );
    });
    socket.on("error", (error: Error) =>
      finish({ kind: "Error", error: error.message }),
    );
  });
};
