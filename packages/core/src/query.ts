import type { Sequence } from "shared";

import { stringifySequence } from "./rules";
import { compilePattern } from "./sequenceText";

// The query language. A term is one of:
//   `regex`             sequences whose text matches the regex
//   node(id, ...)       the sequences with these ids
//   children(id, ...)   the immediate children of these sequences
//   ( query )           grouping
// Terms are joined by AND (binds tighter) and OR. An empty query matches everything.

type Token =
  | { kind: "regex"; text: string }
  | { kind: "word"; text: string }
  | { kind: "op"; text: "AND" | "OR" }
  | { kind: "punct"; text: "(" | ")" | "," };

class QueryError extends Error {}

const tokenize = (query: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;
  while (index < query.length) {
    const char = query.charAt(index);
    if (/\s/.test(char)) {
      index += 1;
    } else if (char === "`") {
      const end = query.indexOf("`", index + 1);
      if (end === -1) throw new QueryError("A regex needs a closing backtick");
      tokens.push({ kind: "regex", text: query.slice(index + 1, end) });
      index = end + 1;
    } else if (char === "(" || char === ")" || char === ",") {
      tokens.push({ kind: "punct", text: char });
      index += 1;
    } else {
      const word = /^[A-Za-z0-9_-]+/.exec(query.slice(index));
      if (word === null) throw new QueryError(`Unexpected "${char}"`);
      const text = word[0];
      if (text === "AND" || text === "OR") {
        tokens.push({ kind: "op", text });
      } else {
        tokens.push({ kind: "word", text });
      }
      index += text.length;
    }
  }
  return tokens;
};

export type QueryResult =
  { kind: "ok"; ids: Set<string> } | { kind: "error"; message: string };

// texts holds each sequence's stringified text, built once per change to the sequences
export const sequenceTexts = (sequences: Sequence[]) =>
  new Map(
    sequences.map((sequence) => [sequence.id, stringifySequence(sequence)]),
  );

const parse = (
  tokens: Token[],
  sequences: Sequence[],
  texts: Map<string, string>,
  vars: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> => {
  let position = 0;

  const peek = () => tokens[position];
  const next = () => {
    const token = tokens[position];
    if (token === undefined) throw new QueryError("The query ends too early");
    position += 1;
    return token;
  };
  const isPunct = (text: string) => {
    const token = peek();
    return token?.kind === "punct" && token.text === text;
  };
  const isOp = (text: "AND" | "OR") => {
    const token = peek();
    return token?.kind === "op" && token.text === text;
  };
  const expectPunct = (text: string) => {
    if (!isPunct(text)) throw new QueryError(`Expected "${text}"`);
    position += 1;
  };

  const knownIds = (ids: string[]) => {
    for (const id of ids) {
      if (!sequences.some((sequence) => sequence.id === id)) {
        throw new QueryError(`No sequence has the id "${id}"`);
      }
    }
  };

  // The ids in node(...) or children(...), separated by commas
  const idList = () => {
    expectPunct("(");
    const ids: string[] = [];
    let more = true;
    while (more) {
      const token = next();
      if (token.kind !== "word") throw new QueryError("Expected a sequence id");
      ids.push(token.text);
      more = isPunct(",");
      if (more) position += 1;
    }
    expectPunct(")");
    knownIds(ids);
    return ids;
  };

  const regexTerm = (pattern: string) => {
    const compiled = compilePattern(pattern);
    if (compiled.kind === "error") {
      throw new QueryError(`Invalid regex: ${compiled.message}`);
    }
    const { regex } = compiled;
    return new Set(
      sequences
        .filter((sequence) => regex.test(texts.get(sequence.id) ?? ""))
        .map((sequence) => sequence.id),
    );
  };

  const factor = (): Set<string> => {
    const token = next();
    if (token.kind === "regex") return regexTerm(token.text);
    if (token.kind === "punct" && token.text === "(") {
      const inner = orExpr();
      expectPunct(")");
      return inner;
    }
    if (token.kind === "word" && isPunct("(")) {
      if (token.text === "node") return new Set(idList());
      if (token.text === "children") {
        const parents = new Set(idList());
        return new Set(
          sequences
            .filter(
              (sequence) =>
                sequence.parentId !== undefined &&
                parents.has(sequence.parentId),
            )
            .map((sequence) => sequence.id),
        );
      }
    }
    if (token.kind === "word") {
      const bound = vars.get(token.text);
      if (bound !== undefined) return new Set(bound);
      throw new QueryError(
        `"${token.text}" is not a variable defined above or a function; regexes go in backticks, functions are node(...) and children(...)`,
      );
    }
    throw new QueryError("Expected a regex, node(...), children(...) or (...)");
  };

  const andExpr = (): Set<string> => {
    let result = factor();
    while (isOp("AND")) {
      position += 1;
      const right = factor();
      result = new Set([...result].filter((id) => right.has(id)));
    }
    return result;
  };

  const orExpr = (): Set<string> => {
    let result = andExpr();
    while (isOp("OR")) {
      position += 1;
      result = new Set([...result, ...andExpr()]);
    }
    return result;
  };

  const result = orExpr();
  const leftover = peek();
  if (leftover !== undefined) {
    throw new QueryError(`Unexpected "${leftover.text}"`);
  }
  return result;
};

// Runs a query over the sequences. vars holds named sets a query can use by
// name, as a script's var statements define them. An error is returned, not
// thrown, so a view can show it while the query is being typed.
export const runQuery = (
  query: string,
  sequences: Sequence[],
  texts: Map<string, string>,
  vars: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): QueryResult => {
  if (query.trim() === "") {
    return { kind: "ok", ids: new Set(sequences.map((s) => s.id)) };
  }
  try {
    return {
      kind: "ok",
      ids: parse(tokenize(query), sequences, texts, vars),
    };
  } catch (error) {
    if (error instanceof QueryError) {
      return { kind: "error", message: error.message };
    }
    throw error;
  }
};
