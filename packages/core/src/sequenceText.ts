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

// Accepts a Python-style pattern. Leading (?s) and (?m) mean "dot matches
// newlines" and "^ and $ match at each line", which JavaScript spells with flags.
export const compilePattern = (pattern: string) => {
  const leading = /^\(\?([sm]+)\)/.exec(pattern);
  const flags = leading?.[1] ?? "";
  const source = leading ? pattern.slice(leading[0].length) : pattern;
  try {
    return {
      kind: "ok" as const,
      regex: new RegExp(source, flags),
    };
  } catch (error) {
    return {
      kind: "error" as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};
