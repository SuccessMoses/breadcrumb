// Files attached to a template. A line "# ``file name = filename|base64" holds
// the bytes, and placeholders put them into the request:
//   {{upload:name}}  a multipart/form-data part for the file (the template's
//                    headers must say: Content-Type: multipart/form-data; boundary=breadcrumb)
//   {{file:name}}    the file's bytes as they are, for a raw body
// The bytes are written between UPLOAD_START and UPLOAD_END as base64. Only the
// CLI can send them; the plugin refuses requests that contain them.

export const UPLOAD_START = "\u0001";
export const UPLOAD_END = "\u0002";
export const UPLOAD_BOUNDARY = "breadcrumb";

const FILE =
  /^[ \t]*#[ \t]*``file[ \t]+([A-Za-z_]\w*)[ \t]*=[ \t]*([^|\r\n]+)\|([A-Za-z0-9+/=]*)[ \t]*$/;

export type Upload = { name: string; filename: string; data: string };

export const uploadsOf = (text: string): Upload[] =>
  text.split("\n").flatMap((line) => {
    const match = FILE.exec(line.replace(/\r$/, ""));
    if (match === null) return [];
    return [
      {
        name: match[1] ?? "",
        filename: (match[2] ?? "").trim(),
        data: match[3] ?? "",
      },
    ];
  });

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  pdf: "application/pdf",
  json: "application/json",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
};

const mimeOf = (filename: string): string =>
  MIME[filename.split(".").pop()?.toLowerCase() ?? ""] ??
  "application/octet-stream";

// Replaces the upload placeholders; a name with no attached file is left as it
// is, so the value fill reports it as missing
export const expandUploads = (text: string): string => {
  const uploads = new Map(
    uploadsOf(text).map((upload) => [upload.name, upload]),
  );
  return text
    .replace(/\{\{upload:([A-Za-z_]\w*)\}\}/g, (match, name: string) => {
      const upload = uploads.get(name);
      if (upload === undefined) return match;
      return [
        `--${UPLOAD_BOUNDARY}`,
        `Content-Disposition: form-data; name="${name}"; filename="${upload.filename}"`,
        `Content-Type: ${mimeOf(upload.filename)}`,
        "",
        `${UPLOAD_START}${upload.data}${UPLOAD_END}`,
        `--${UPLOAD_BOUNDARY}--`,
        "",
      ].join("\r\n");
    })
    .replace(/\{\{file:([A-Za-z_]\w*)\}\}/g, (match, name: string) => {
      const upload = uploads.get(name);
      if (upload === undefined) return match;
      return `${UPLOAD_START}${upload.data}${UPLOAD_END}`;
    });
};
