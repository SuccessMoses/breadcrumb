import { compilePattern } from "@/query/sequenceText";

// A capture reads a value out of a rendered step and makes it available to the
// later steps of the same sequence as {{name}}.
export type Capture = { name: string; regex: string };

export type TemplateRule = {
  // Send the request while rendering, so captures can read the response
  sendOnRender: boolean;
  captures: Capture[];
};

export const NO_RULE: TemplateRule = { sendOnRender: false, captures: [] };

// Between a step's request and its response, in the text captures run over
export const RESPONSE_DIVIDER = "\x1e-----response-----\r\n";

const PLACEHOLDER = /\{\{([^{}]+)\}\}/g;

// Replaces {{name}} with the captured value. Unknown names are left as written.
export const fillCaptures = (
  text: string,
  values: Record<string, string>,
): string =>
  text.replace(PLACEHOLDER, (whole, name: string) =>
    Object.hasOwn(values, name) ? (values[name] ?? "") : whole,
  );

// The distinct names a template reads with {{name}}
export const placeholderNames = (text: string): string[] => [
  ...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "")),
];

// The last capture group of the first match. No groups means the whole match,
// and no match means an empty value.
const captured = (match: RegExpExecArray | undefined): string => {
  if (match === undefined) return "";
  if (match.length === 1) return match[0];
  return match[match.length - 1] ?? "";
};

type CaptureResult =
  | { kind: "ok"; values: Record<string, string> }
  | { kind: "error"; message: string };

export const runCaptures = (
  captures: Capture[],
  subject: string,
): CaptureResult => {
  const values: Record<string, string> = {};
  for (const capture of captures) {
    const name = capture.name.trim();
    if (name === "") continue;
    const pattern = compilePattern(capture.regex);
    if (pattern.kind === "error") {
      return {
        kind: "error",
        message: `Capture "${name}": ${pattern.message}`,
      };
    }
    values[name] = captured(pattern.regex.exec(subject) ?? undefined);
  }
  return { kind: "ok", values };
};
