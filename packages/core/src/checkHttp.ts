import { captureOf, isComment, STRUCK } from "./notes";
import { compilePattern } from "./sequenceText";

type Issue = { line: number; severity: "error" | "warning"; message: string };
type Kept = { line: number; text: string };

const METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);
const REQUEST_LINE = /^([A-Za-z]+) (\S+) HTTP\/\d(?:\.\d)?$/;
const HEADER = /^[^:\s][^:]*:/;
const HOST_HEADER = /^host:/i;
const CONTENT_TYPE = /^content-type:/i;
const WHOLE_STRUCK = /^[ \t]*~~[^\n]*?~~[ \t]*$/;
// Placeholders are stood in for by 0, so the body can still be checked as JSON
const PLACEHOLDER = /\{\{[^{}]+\}\}|\{random\}/g;

// The lines as they will be sent: fully struck lines are dropped, struck spans
// are removed, and placeholders become 0. Line numbers stay the editor's.
const keptLines = (text: string): Kept[] => {
  const kept: Kept[] = [];
  text.split("\n").forEach((raw, index) => {
    const line = raw.replace(/\r$/, "");
    if (isComment(line) || WHOLE_STRUCK.test(line)) return;
    kept.push({
      line: index + 1,
      text: line.replace(STRUCK, "").replace(PLACEHOLDER, "0"),
    });
  });
  return kept;
};

// The editor line that a character offset into the lines' joined text falls on
const lineAt = (lines: Kept[], offset: number): number => {
  let start = 0;
  for (const kept of lines) {
    const end = start + kept.text.length;
    if (offset <= end) return kept.line;
    start = end + 1;
  }
  return lines[lines.length - 1]?.line ?? 1;
};

// Reports problems in a request as the editor shows it. The request is checked
// as it will be sent, so struck text and placeholders do not count.
export const checkHttp = (text: string): Issue[] => {
  const issues: Issue[] = [];
  const add = (line: number, severity: "error" | "warning", message: string) =>
    issues.push({ line, severity, message });

  // Captures are read from comment lines, which the checks below skip
  text.split("\n").forEach((line, index) => {
    const capture = captureOf(line);
    if (capture === undefined) return;
    const pattern = compilePattern(capture.regex);
    if (pattern.kind === "error") {
      add(index + 1, "error", `Capture ${capture.name}: ${pattern.message}`);
    }
  });

  const kept = keptLines(text);
  const first = kept[0];
  if (first === undefined) {
    add(1, "error", "Request is empty");
    return issues;
  }

  const match = REQUEST_LINE.exec(first.text);
  if (match !== null) {
    const [, method = "", target = ""] = match;
    if (!METHODS.has(method))
      add(first.line, "error", `Unknown method ${method}`);
    if (!target.startsWith("/") && !/^https?:\/\//.test(target)) {
      add(first.line, "error", "Path must start with /");
    }
  } else if (/^\S+ \S+$/.test(first.text)) {
    add(first.line, "error", "Missing HTTP version, e.g. HTTP/1.1");
  } else {
    add(first.line, "error", "Request line must be METHOD /path HTTP/1.1");
  }

  // The headers end at the first empty line; without one the request is cut off
  const bodyStart = kept.findIndex((k, index) => index > 0 && k.text === "");
  if (bodyStart === -1) {
    const last = kept[kept.length - 1] ?? first;
    add(last.line, "error", "Request is not ended by an empty line");
  }
  const headers = kept.slice(1, bodyStart === -1 ? kept.length : bodyStart);

  for (const header of headers) {
    if (!HEADER.test(header.text)) {
      add(header.line, "error", "Header has no colon: Name: value");
    }
  }
  if (!headers.some((h) => HOST_HEADER.test(h.text))) {
    add(first.line, "warning", "No Host header");
  }

  // Check the body as JSON when it is declared as JSON or starts like it
  const bodyLines = bodyStart === -1 ? [] : kept.slice(bodyStart + 1);
  const bodyText = bodyLines.map((k) => k.text).join("\n");
  const contentType =
    headers.find((h) => CONTENT_TYPE.test(h.text))?.text ?? "";
  const looksJson = /json/i.test(contentType) || /^\s*[{[]/.test(bodyText);
  if (bodyText.trim() !== "" && looksJson) {
    try {
      JSON.parse(bodyText);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const position = /position (\d+)/.exec(message)?.[1];
      const line =
        position === undefined
          ? (bodyLines[0]?.line ?? first.line)
          : lineAt(bodyLines, Number(position));
      const reason = message
        .replace(/ in JSON at position.*$/, "")
        .slice(0, 80);
      add(line, "error", `Invalid JSON: ${reason}`);
    }
  }

  return issues.sort((a, b) => a.line - b.line);
};
