import type { Sequence } from "shared";

// Separates the requests inside a sequence's text. Raw HTTP cannot contain it.
const REQUEST_SEPARATOR = "\x1e";
const RESPONSE_MARK = "\n-- response --\n";
const RESPONSE_HEAD_CHARS = 300;

// A sequence as one string: each request, then its response head, with the
// requests joined by the record separator. Regexes in a query run over this.
export const sequenceText = (sequence: Sequence) =>
  sequence.steps
    .map(
      (step) =>
        step.request +
        RESPONSE_MARK +
        (step.response === undefined
          ? "(no response)"
          : step.response.slice(0, RESPONSE_HEAD_CHARS)),
    )
    .join(REQUEST_SEPARATOR);

// Accepts a Python-style pattern. A leading (?s) means "dot matches newlines",
// which JavaScript spells with the s flag.
export const compilePattern = (pattern: string) => {
  const dotAll = pattern.startsWith("(?s)");
  const source = dotAll ? pattern.slice(4) : pattern;
  try {
    return {
      kind: "ok" as const,
      regex: new RegExp(source, dotAll ? "s" : ""),
    };
  } catch (error) {
    return {
      kind: "error" as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};
