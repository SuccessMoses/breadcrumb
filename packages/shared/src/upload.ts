// Files in a request travel as base64 between UPLOAD_START and UPLOAD_END. The
// request is then turned into exact bytes: text is UTF-8, each segment is the
// file's bytes, and Content-Length counts the bytes. Plain JavaScript, so it runs
// in the plugin backend (QuickJS) as well as Node.

export const UPLOAD_START = "\u0001";
export const UPLOAD_END = "\u0002";
export const UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const utf8 = (text: string): number[] => {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
};

const fromBase64 = (data: string): number[] => {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of data) {
    if (char === "=") break;
    const value = BASE64.indexOf(char);
    if (value < 0) continue;
    buffer = ((buffer << 6) | value) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes;
};

export const encodeBase64 = (bytes: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += BASE64[(triple >> 18) & 63];
    out += BASE64[(triple >> 12) & 63];
    out += b === undefined ? "=" : BASE64[(triple >> 6) & 63];
    out += c === undefined ? "=" : BASE64[triple & 63];
  }
  return out;
};

// The bytes of a request that holds uploads. Each line break becomes CRLF.
export const requestBytes = (raw: string): Uint8Array => {
  const lined = raw.replace(/\r?\n/g, "\r\n");
  const end = lined.indexOf("\r\n\r\n");
  const head = end === -1 ? lined : lined.slice(0, end);
  const body = end === -1 ? "" : lined.slice(end + 4);

  const parts: number[][] = [];
  const segment = new RegExp(
    `${UPLOAD_START}([A-Za-z0-9+/=]*)${UPLOAD_END}`,
    "g",
  );
  let last = 0;
  for (
    let match = segment.exec(body);
    match !== null;
    match = segment.exec(body)
  ) {
    parts.push(utf8(body.slice(last, match.index)));
    parts.push(fromBase64(match[1] ?? ""));
    last = match.index + match[0].length;
  }
  parts.push(utf8(body.slice(last)));

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const line = `Content-Length: ${total}`;
  const withLength = /^content-length:/im.test(head)
    ? head.replace(/^content-length:.*$/im, line)
    : `${head}\r\n${line}`;
  const headBytes = utf8(`${withLength}\r\n\r\n`);

  const out = new Uint8Array(headBytes.length + total);
  out.set(headBytes, 0);
  let offset = headBytes.length;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
