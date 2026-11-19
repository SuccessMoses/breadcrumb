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
export const normalizeRaw = (raw: string) => {
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
