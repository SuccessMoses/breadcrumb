import { compilePattern } from "./sequenceText";

// A capture reads values out of a rendered step and makes them available to the
// later steps of the same sequence as {{name}}.
export type Capture = { name: string; regex: string };

// Between a step's request and its response, in the text captures run over
export const RESPONSE_DIVIDER = "\x1e-----response-----\r\n";

// A placeholder is {{source|spec as name}}, {{$name}} or nothing else.
// source: a dict or capture name, a builtin (bool, char), or a list in brackets
//   such as [1..12], [a-z,0..9] or [yes,no]. Ranges take .. or ... (A-Z for letters)
// spec: empty or last for the last value, 1 for the first, 2 for the second, * for
//   each value in turn, one rendering for each (and every combination across them)
// as name: also binds the value chosen, for {{$name}} later in the same template
const PLACEHOLDER = /\{\{([^{}]+)\}\}/g;
const AS = /^(.*\S)\s+as\s+([A-Za-z_]\w*)$/;
const REFERENCE = /^\$([A-Za-z_]\w*)$/;
const RANGE = /^(.+?)\.{2,3}(.+)$/;
// A-Za-z: one or more pairs of single characters joined by a hyphen
const LETTER_RANGES = /^(?:.-.)+$/;
const LETTER_PAIR = /(.)-(.)/g;
const INTEGER = /^-?\d+$/;

// The values from one end of a range to the other, inclusive, for two whole
// numbers or two single characters. Anything else is not a range.
const between = (from: string, to: string): string[] | undefined => {
  const numbers = INTEGER.test(from) && INTEGER.test(to);
  const letters = from.length === 1 && to.length === 1;
  if (!numbers && !letters) return undefined;
  const first = numbers ? Number(from) : from.charCodeAt(0);
  const last = numbers ? Number(to) : to.charCodeAt(0);
  const step = first <= last ? 1 : -1;
  const out: string[] = [];
  for (let n = first; step > 0 ? n <= last : n >= last; n += step) {
    out.push(numbers ? String(n) : String.fromCharCode(n));
  }
  return out;
};

// The items one comma-separated part of a list gives. A range is 1..12, 1...12,
// or letter pairs such as A-Za-z; anything else is one item.
const expandItem = (item: string): string[] => {
  if (LETTER_RANGES.test(item)) {
    return [...item.matchAll(LETTER_PAIR)].flatMap(
      (pair) => between(pair[1] ?? "", pair[2] ?? "") ?? [],
    );
  }
  const range = RANGE.exec(item);
  if (range === null) return [item];
  return between((range[1] ?? "").trim(), (range[2] ?? "").trim()) ?? [item];
};

const listItems = (body: string): string[] => [
  ...new Set(
    body
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .flatMap(expandItem),
  ),
];

// Used when no dict or capture gives the name a value
const BUILTINS: Record<string, string[] | undefined> = {
  bool: ["true", "false"],
  char: listItems("a-z,A-Z"),
};

// The source of a value: a name looked up at render time, or a literal list.
// key identifies it in fixed choices and in one rendering's choices.
type Source =
  | { kind: "name"; key: string; name: string }
  | { kind: "list"; key: string; items: string[] };

type Piece =
  | {
      kind: "value";
      source: Source;
      index: number | "*" | "last" | undefined;
      bind: string | undefined;
    }
  | { kind: "reference"; name: string };

const parseSource = (raw: string): Source => {
  const text = raw.trim();
  if (text.startsWith("[") && text.endsWith("]")) {
    return { kind: "list", key: text, items: listItems(text.slice(1, -1)) };
  }
  return { kind: "name", key: text, name: text };
};

const parseSpec = (spec: string): number | "*" | "last" | undefined => {
  if (spec === "" || spec === "last") return "last";
  if (spec === "*") return "*";
  const position = /^\d+$/.test(spec) ? Number(spec) : 0;
  return position >= 1 ? position - 1 : undefined;
};

const parsePiece = (inner: string): Piece => {
  const asMatch = AS.exec(inner.trim());
  const body = (asMatch?.[1] ?? inner).trim();
  const reference = REFERENCE.exec(body);
  if (reference !== null)
    return { kind: "reference", name: reference[1] ?? "" };
  const bar = body.indexOf("|");
  return {
    kind: "value",
    source: parseSource(bar === -1 ? body : body.slice(0, bar)),
    index: parseSpec(bar === -1 ? "" : body.slice(bar + 1).trim()),
    bind: asMatch?.[2],
  };
};

// The values a source can take: the template's own dict and capture values first,
// then the builtin of the same name
const listOf = (
  source: Source,
  values: Record<string, string[]>,
): string[] | undefined => {
  if (source.kind === "list") {
    return source.items.length > 0 ? source.items : undefined;
  }
  if (Object.hasOwn(values, source.name)) return values[source.name];
  return Object.hasOwn(BUILTINS, source.name)
    ? BUILTINS[source.name]
    : undefined;
};

// The value at a position of a list, if there is one
const valueAt = (list: string[], index: number | "last"): string | undefined =>
  list[index === "last" ? list.length - 1 : index];

const isMet = (
  list: string[] | undefined,
  index: number | "*" | "last" | undefined,
): boolean => {
  if (list === undefined || index === undefined) return false;
  if (index === "*") return list.length > 0;
  return valueAt(list, index) !== undefined;
};

// The placeholders of a template that have no value to take, by source. A
// {{$name}} with no {{... as name}} in the same template is one too.
export const unmetNames = (
  text: string,
  values: Record<string, string[]>,
): string[] => {
  const pieces = [...text.matchAll(PLACEHOLDER)].map((match) =>
    parsePiece(match[1] ?? ""),
  );
  const bound = new Set(
    pieces.flatMap((piece) =>
      piece.kind === "value" && piece.bind !== undefined ? [piece.bind] : [],
    ),
  );
  const unmet = new Set<string>();
  for (const piece of pieces) {
    if (piece.kind === "reference") {
      if (!bound.has(piece.name)) unmet.add(`$${piece.name}`);
    } else if (!isMet(listOf(piece.source, values), piece.index)) {
      unmet.add(piece.source.key);
    }
  }
  return [...unmet];
};

// One rendering of a template: the request, and the value each fan-out source
// gave it (by source key)
type Filling = { request: string; choice: Record<string, string> };

// Fills the placeholders of a template. A placeholder with no value makes the
// template skip this render, so no renderings are returned.
export const fillCaptures = (
  text: string,
  values: Record<string, string[]>,
  fixed: Record<string, string> = {},
): Filling[] => {
  if (unmetNames(text, values).length > 0) return [];

  const pieces = [...text.matchAll(PLACEHOLDER)].map((match) => ({
    whole: match[0],
    piece: parsePiece(match[1] ?? ""),
  }));

  // The single values, by the whole placeholder text they fill
  const single = new Map<string, string>();
  for (const { whole, piece } of pieces) {
    if (piece.kind !== "value" || piece.index === undefined) continue;
    if (piece.index === "*") continue;
    const value = valueAt(listOf(piece.source, values) ?? [], piece.index);
    if (value !== undefined) single.set(whole, value);
  }

  // Every combination of the fan-out values; a source repeated keeps one value
  const fanned = new Map<string, Source>();
  for (const { piece } of pieces) {
    if (piece.kind === "value" && piece.index === "*") {
      fanned.set(piece.source.key, piece.source);
    }
  }
  let combinations: Record<string, string>[] = [{}];
  for (const source of fanned.values()) {
    const options = (listOf(source, values) ?? []).filter(
      (value) => fixed[source.key] === undefined || value === fixed[source.key],
    );
    combinations = combinations.flatMap((choice) =>
      options.map((value) => ({ ...choice, [source.key]: value })),
    );
  }

  return combinations.map((choice) => {
    // What each {{... as name}} chose in this rendering
    const bound: Record<string, string> = {};
    for (const { whole, piece } of pieces) {
      if (piece.kind !== "value" || piece.bind === undefined) continue;
      const value =
        piece.index === "*" ? choice[piece.source.key] : single.get(whole);
      if (value !== undefined) bound[piece.bind] = value;
    }
    return {
      choice,
      request: text.replace(PLACEHOLDER, (whole, inner: string) => {
        const piece = parsePiece(inner);
        if (piece.kind === "reference") return bound[piece.name] ?? whole;
        if (piece.index === "*") return choice[piece.source.key] ?? whole;
        return single.get(whole) ?? whole;
      }),
    };
  });
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
