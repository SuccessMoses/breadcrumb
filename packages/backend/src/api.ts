import type { SDK } from "caido:plugin";
import { RequestSpecRaw } from "caido:utils";
import type { Result } from "shared";
import { err, ok } from "shared";

const HOST_HEADER = /^host:\s*(.+)$/im;
const CONTENT_LENGTH = /^content-length:.*$/im;
const HEAD_END = /\r?\n\r?\n/;

// UTF-8 byte count of a string
const byteLength = (text: string) =>
  encodeURIComponent(text).replace(/%[0-9A-F]{2}/g, "x").length;

// The raw text is sent as written, with two repairs. A head that does not end
// with an empty line leaves the server waiting for more headers until it times
// out, which is what a body-less request saved with a single trailing newline
// looks like. A body without a matching Content-Length is read by the server as
// empty, and the body is then parsed as a second request.
const normalizeRaw = (raw: string) => {
  const end = HEAD_END.exec(raw);
  if (end === null) return `${raw.replace(/(?:\r?\n)+$/, "")}\r\n\r\n`;

  const head = raw.slice(0, end.index);
  const body = raw.slice(end.index + end[0].length);
  if (body === "") return raw;

  const line = `Content-Length: ${byteLength(body)}`;
  const withLength = CONTENT_LENGTH.test(head)
    ? head.replace(CONTENT_LENGTH, line)
    : `${head}\r\n${line}`;
  return `${withLength}${end[0]}${body}`;
};

export async function currentProjectId(
  sdk: SDK,
): Promise<Result<string | undefined>> {
  const project = await sdk.projects.getCurrent();
  return ok(project?.getId());
}

export async function sendRaw(sdk: SDK, raw: string): Promise<Result<string>> {
  const host = HOST_HEADER.exec(raw)?.[1]?.trim();
  if (host === undefined || host === "")
    return err("Request has no Host header");

  const spec = new RequestSpecRaw(`http://${host}`);
  spec.setRaw(normalizeRaw(raw));
  try {
    const { response } = await sdk.requests.send(spec);
    return ok(response.getRaw().toText());
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
