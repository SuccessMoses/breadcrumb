import type { Sequence } from "shared";

import { runQuery, sequenceTexts } from "./query";

// A script is a list of statements, each ended by ";":
//   var name = expression;
//   rule name="..." message="..." expression;
// Expressions use the query language, and a var name stands for the set its
// expression matched. A rule logs its message for each sequence it matches.
export type Script = { id: string; name: string; code: string };

export type LogEntry = {
  id: string;
  time: number;
  scriptName: string;
  ruleName: string;
  message: string;
  sequenceId: string;
};

export const LOG_LIMIT = 1000;

const RESERVED = new Set([
  "var",
  "rule",
  "node",
  "children",
  "delete",
  "AND",
  "OR",
]);
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ATTRIBUTE = /^\s*(name|message)\s*=\s*"((?:[^"\\]|\\.)*)"/;

type Statement = { text: string; line: number };

const lineAt = (code: string, position: number) =>
  code.slice(0, position).split("\n").length;

// Splits the code at each ";" that is outside a regex and a quoted string
const splitStatements = (
  code: string,
):
  | { kind: "ok"; statements: Statement[] }
  | { kind: "error"; message: string } => {
  const statements: Statement[] = [];
  let start = 0;
  let inRegex = false;
  let inQuote = false;
  for (let index = 0; index < code.length; index++) {
    const char = code.charAt(index);
    if (inRegex) {
      if (char === "`") inRegex = false;
    } else if (inQuote) {
      if (char === "\\") index += 1;
      else if (char === '"') inQuote = false;
    } else if (char === "`") {
      inRegex = true;
    } else if (char === '"') {
      inQuote = true;
    } else if (char === ";") {
      const text = code.slice(start, index);
      if (text.trim() !== "") {
        const offset = start + (text.length - text.trimStart().length);
        statements.push({ text, line: lineAt(code, offset) });
      }
      start = index + 1;
    }
  }
  const line = lineAt(code, start);
  if (inRegex)
    return {
      kind: "error",
      message: `Line ${line}: A regex needs a closing backtick`,
    };
  if (inQuote)
    return {
      kind: "error",
      message: `Line ${line}: A message needs a closing quote`,
    };
  if (code.slice(start).trim() !== "") {
    return {
      kind: "error",
      message: `Line ${line}: The last statement needs a closing ;`,
    };
  }
  return { kind: "ok", statements };
};

type Parsed =
  | { kind: "var"; name: string; expression: string }
  | { kind: "rule"; name: string; message: string; expression: string };

const parseStatement = (
  text: string,
): Parsed | { kind: "error"; message: string } => {
  const trimmed = text.trim();
  if (/^var\s/.test(trimmed)) {
    const match = /^var\s+([A-Za-z_][A-Za-z0-9_]*)\s*=([\s\S]*)$/.exec(trimmed);
    if (match === null)
      return { kind: "error", message: "Expected var name = expression" };
    const [, name = "", expression = ""] = match;
    if (RESERVED.has(name) || !NAME.test(name)) {
      return { kind: "error", message: `"${name}" cannot be a variable name` };
    }
    return { kind: "var", name, expression: expression.trim() };
  }
  if (/^rule\s/.test(trimmed)) {
    const attributes: Record<string, string> = {};
    let rest = trimmed.slice("rule".length);
    for (;;) {
      const match = ATTRIBUTE.exec(rest);
      if (match === null) break;
      const [whole = "", key = "", value = ""] = match;
      if (attributes[key] !== undefined) {
        return { kind: "error", message: `"${key}" is given twice` };
      }
      attributes[key] = value.replace(/\\(.)/g, "$1");
      rest = rest.slice(whole.length);
    }
    const name = attributes.name;
    const message = attributes.message;
    if (name === undefined || name.trim() === "") {
      return { kind: "error", message: 'A rule needs name="..."' };
    }
    if (message === undefined) {
      return { kind: "error", message: 'A rule needs message="..."' };
    }
    return { kind: "rule", name, message, expression: rest.trim() };
  }
  const word = /^\S*/.exec(trimmed)?.[0] ?? "";
  return { kind: "error", message: `Expected var or rule, found "${word}"` };
};

export type ScriptRule = { name: string; message: string; ids: Set<string> };

export type ScriptCheck =
  | { kind: "ok"; rules: ScriptRule[]; deletes: Set<string> }
  | { kind: "error"; message: string };

// Evaluates one script over all the sequences. Statements run top to bottom, so
// a var is only usable below its own statement. A script with an error gives
// no rules, and the error names its line.
export const checkScript = (
  code: string,
  sequences: Sequence[],
  texts: Map<string, string>,
): ScriptCheck => {
  const split = splitStatements(code);
  if (split.kind === "error") return split;

  const vars = new Map<string, Set<string>>();
  const rules: ScriptRule[] = [];
  const deletes = new Set<string>();
  for (const statement of split.statements) {
    const parsed = parseStatement(statement.text);
    if (parsed.kind === "error") {
      return {
        kind: "error",
        message: `Line ${statement.line}: ${parsed.message}`,
      };
    }
    if (parsed.expression === "") {
      return {
        kind: "error",
        message: `Line ${statement.line}: Missing expression`,
      };
    }
    const result = runQuery(parsed.expression, sequences, texts, vars);
    if (result.kind === "error") {
      return {
        kind: "error",
        message: `Line ${statement.line}: ${result.message}`,
      };
    }
    for (const id of result.deletes) deletes.add(id);
    if (parsed.kind === "var") {
      vars.set(parsed.name, result.ids);
    } else {
      if (rules.some((rule) => rule.name === parsed.name)) {
        return {
          kind: "error",
          message: `Line ${statement.line}: A rule named "${parsed.name}" already exists in this script`,
        };
      }
      rules.push({
        name: parsed.name,
        message: parsed.message,
        ids: result.ids,
      });
    }
  }
  return { kind: "ok", rules, deletes };
};

export type NewLog = Omit<LogEntry, "id" | "time">;

// The log entries for the given sequences. Each sequence logs the message of
// the first rule it matches, looking at the scripts in order and their rules
// top to bottom, so one sequence logs at most one message. Scripts with an
// error are skipped.
export const logMatches = (
  scripts: Script[],
  sequences: Sequence[],
  sequenceIds: string[],
): { logs: NewLog[]; deletes: Set<string> } => {
  const texts = sequenceTexts(sequences);
  const rules: (ScriptRule & { scriptName: string })[] = [];
  const deletes = new Set<string>();
  for (const script of scripts) {
    const check = checkScript(script.code, sequences, texts);
    if (check.kind === "ok") {
      for (const rule of check.rules) {
        rules.push({ ...rule, scriptName: script.name });
      }
      for (const id of check.deletes) deletes.add(id);
    }
  }
  const logs: NewLog[] = [];
  for (const sequenceId of sequenceIds) {
    const first = rules.find((rule) => rule.ids.has(sequenceId));
    if (first !== undefined) {
      logs.push({
        scriptName: first.scriptName,
        ruleName: first.name,
        message: first.message,
        sequenceId,
      });
    }
  }
  return { logs, deletes };
};

const isText = (value: unknown): value is string => typeof value === "string";

export const restoreScripts = (value: unknown): Script[] =>
  Array.isArray(value)
    ? value.flatMap((item): Script[] =>
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        "name" in item &&
        "code" in item &&
        isText(item.id) &&
        isText(item.name) &&
        isText(item.code)
          ? [{ id: item.id, name: item.name, code: item.code }]
          : [],
      )
    : [];

// Rules from before scripts existed: each becomes a script with one rule that
// logs its name. A rule with an empty pattern becomes an empty script.
const escapeAttribute = (text: string) =>
  text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export const scriptsFromRules = (value: unknown): Script[] =>
  Array.isArray(value)
    ? value.flatMap((item): Script[] => {
        if (
          typeof item !== "object" ||
          item === null ||
          !("id" in item) ||
          !("name" in item) ||
          !("pattern" in item) ||
          !isText(item.id) ||
          !isText(item.name) ||
          !isText(item.pattern)
        ) {
          return [];
        }
        const name = escapeAttribute(item.name);
        const code =
          item.pattern.trim() === ""
            ? ""
            : `rule name="${name}" message="${name}" ${item.pattern};`;
        return [{ id: item.id, name: item.name, code }];
      })
    : [];

export const restoreLogs = (value: unknown): LogEntry[] =>
  Array.isArray(value)
    ? value
        .flatMap((item): LogEntry[] =>
          typeof item === "object" &&
          item !== null &&
          "id" in item &&
          "time" in item &&
          "scriptName" in item &&
          "ruleName" in item &&
          "message" in item &&
          "sequenceId" in item &&
          isText(item.id) &&
          typeof item.time === "number" &&
          isText(item.scriptName) &&
          isText(item.ruleName) &&
          isText(item.message) &&
          isText(item.sequenceId)
            ? [
                {
                  id: item.id,
                  time: item.time,
                  scriptName: item.scriptName,
                  ruleName: item.ruleName,
                  message: item.message,
                  sequenceId: item.sequenceId,
                },
              ]
            : [],
        )
        .slice(-LOG_LIMIT)
    : [];
