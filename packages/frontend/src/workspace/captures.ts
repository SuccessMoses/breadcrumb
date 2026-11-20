import { compilePattern } from "@/query/sequenceText";

// A capture reads values out of a rendered step and makes them available to the
// later steps of the same sequence as {{name}}.
export type Capture = { name: string; regex: string };

export type TemplateRule = { captures: Capture[] };

export const NO_RULE: TemplateRule = { captures: [] };

// Between a step's request and its response, in the text captures run over
export const RESPONSE_DIVIDER = "\x1e-----response-----\r\n";

// {{name}} is the first value, {{name|2}} the second, {{name|*}} each value in
// turn: one rendering for each, and for several of them every combination
const PLACEHOLDER = /\{\{([^{}]+)\}\}/g;

// index: the position of the value (0-based), "*" for each value, or undefined
// when the spec is not understood
type Placeholder = { name: string; index: number | "*" | undefined };

const parsePlaceholder = (inner: string): Placeholder => {
  const bar = inner.indexOf("|");
  const name = (bar === -1 ? inner : inner.slice(0, bar)).trim();
  const spec = bar === -1 ? "" : inner.slice(bar + 1).trim();
  if (spec === "") return { name, index: 0 };
  if (spec === "*") return { name, index: "*" };
  const position = /^\d+$/.test(spec) ? Number(spec) : 0;
  return position >= 1
    ? { name, index: position - 1 }
    : { name, index: undefined };
};

// The placeholders of a template that have no value to take, by name
export const unmetNames = (
  text: string,
  values: Record<string, string[]>,
): string[] => {
  const unmet = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER)) {
    const { name, index } = parsePlaceholder(match[1] ?? "");
    const list = values[name] ?? [];
    const met =
      index === undefined
        ? false
        : index === "*"
          ? list.length > 0
          : list[index] !== undefined;
    if (!met) unmet.add(name);
  }
  return [...unmet];
};

// One rendering of a template: the request, and the {{name|*}} values it uses
type Filling = { request: string; choice: Record<string, string> };

// Fills the placeholders of a template. A placeholder with no value makes the
// template skip this render, so no renderings are returned.
export const fillCaptures = (
  text: string,
  values: Record<string, string[]>,
  fixed: Record<string, string> = {},
): Filling[] => {
  if (unmetNames(text, values).length > 0) return [];

  // The single values, by the whole placeholder text they fill
  const single = new Map<string, string>();
  for (const match of text.matchAll(PLACEHOLDER)) {
    const { name, index } = parsePlaceholder(match[1] ?? "");
    if (typeof index !== "number") continue;
    const value = (values[name] ?? [])[index];
    if (value !== undefined) single.set(match[0], value);
  }

  // Every combination of the {{name|*}} values; a name repeated keeps one value
  const each = [
    ...new Set(
      [...text.matchAll(PLACEHOLDER)]
        .map((match) => parsePlaceholder(match[1] ?? ""))
        .filter((placeholder) => placeholder.index === "*")
        .map((placeholder) => placeholder.name),
    ),
  ];
  let combinations: Record<string, string>[] = [{}];
  for (const name of each) {
    const options = (values[name] ?? []).filter(
      (value) => fixed[name] === undefined || value === fixed[name],
    );
    combinations = combinations.flatMap((choice) =>
      options.map((value) => ({ ...choice, [name]: value })),
    );
  }

  return combinations.map((choice) => ({
    choice,
    request: text.replace(PLACEHOLDER, (whole, inner: string) => {
      const { name, index } = parsePlaceholder(inner);
      if (index === "*") return choice[name] ?? whole;
      return single.get(whole) ?? whole;
    }),
  }));
};

type CaptureResult =
  | { kind: "ok"; values: Record<string, string[]> }
  | { kind: "error"; message: string };

// The last capture group of every match, or the whole match when there are no
// groups. Repeats are dropped, keeping the order they were found in.
export const runCaptures = (
  captures: Capture[],
  subject: string,
): CaptureResult => {
  const values: Record<string, string[]> = {};
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
    const flags = pattern.regex.flags.includes("g")
      ? pattern.regex.flags
      : `${pattern.regex.flags}g`;
    const every = new RegExp(pattern.regex.source, flags);
    const found = [...subject.matchAll(every)]
      .map((match) =>
        match.length === 1 ? match[0] : (match[match.length - 1] ?? ""),
      )
      .filter((value) => value !== "");
    values[name] = [...new Set(found)];
  }
  return { kind: "ok", values };
};
