import type { Sequence } from "shared";

import { RESPONSE_DIVIDER } from "./captures";
import { compilePattern } from "./sequenceText";

// A regex run against each whole sequence, as one string
export type SeqRule = { id: string; name: string; pattern: string };

// A sequence as one string: each request then its full response, with the
// pairs joined by the record separator. Rules match against this text.
export const stringifySequence = (sequence: Sequence) =>
  sequence.steps
    .map(
      (step) =>
        step.request +
        RESPONSE_DIVIDER +
        (step.response === undefined ? "(no response)" : step.response),
    )
    .join("\x1e");

// The ids of the sequences whose text matches the pattern
export const matchSequences = (
  sequences: Sequence[],
  pattern: string,
): { kind: "ok"; ids: string[] } | { kind: "error"; message: string } => {
  const compiled = compilePattern(pattern);
  if (compiled.kind === "error") return compiled;
  const { regex } = compiled;
  return {
    kind: "ok",
    ids: sequences
      .filter((sequence) => regex.test(stringifySequence(sequence)))
      .map((sequence) => sequence.id),
  };
};

const hasText = (value: unknown): value is string => typeof value === "string";

export const restoreSeqRules = (value: unknown): SeqRule[] =>
  Array.isArray(value)
    ? value.flatMap((item): SeqRule[] =>
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        "name" in item &&
        "pattern" in item &&
        hasText(item.id) &&
        hasText(item.name) &&
        hasText(item.pattern)
          ? [{ id: item.id, name: item.name, pattern: item.pattern }]
          : [],
      )
    : [];
