import type { Sequence } from "shared";

import { RESPONSE_DIVIDER } from "./captures";

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
