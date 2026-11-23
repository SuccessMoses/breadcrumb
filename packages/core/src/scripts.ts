// A script is JavaScript. Each sequence an Extend makes is run through the
// scripts in order, with the sequence as one string. A script writes its logs to
// stdout, one JSON object per line with a name and a message:
//   {"name": "team created", "message": "team abc was made"}
// Each such line becomes a log entry. The first script that logs anything for a
// sequence stops the scripts for that sequence.
export type Script = { id: string; name: string; code: string };

export type LogEntry = {
  id: string;
  time: number;
  scriptName: string;
  name: string;
  message: string;
  sequenceId: string;
};

export const LOG_LIMIT = 1000;

// What running a script over one sequence gave: the lines it wrote to stdout,
// and the error that stopped it, if one did
export type ScriptRun = { lines: string[]; error: string | undefined };

export type NewLog = Omit<LogEntry, "id" | "time">;

// Error entries have this name. They do not count as a match.
export const ERROR_NAME = "error";

// The log entries one script's run makes for one sequence. A line that is not
// a JSON object with a name and a message is logged as an error, with the line.
export const entriesFor = (
  scriptName: string,
  sequenceId: string,
  run: ScriptRun,
): NewLog[] => {
  const entries: NewLog[] = [];
  for (const line of run.lines) {
    if (line.trim() === "") continue;
    const parsed = parseLine(line);
    entries.push(
      parsed === undefined
        ? {
            scriptName,
            name: ERROR_NAME,
            message: `Could not read line: ${line}`,
            sequenceId,
          }
        : { scriptName, sequenceId, ...parsed },
    );
  }
  if (run.error !== undefined) {
    entries.push({
      scriptName,
      name: ERROR_NAME,
      message: run.error,
      sequenceId,
    });
  }
  return entries;
};

// Whether a run logged a match: at least one line that was a valid entry
export const isMatch = (entries: NewLog[]) =>
  entries.some((entry) => entry.name !== ERROR_NAME);

const parseLine = (
  line: string,
): { name: string; message: string } | undefined => {
  try {
    const value: unknown = JSON.parse(line);
    if (
      typeof value === "object" &&
      value !== null &&
      "name" in value &&
      "message" in value &&
      typeof value.name === "string" &&
      typeof value.message === "string"
    ) {
      return { name: value.name, message: value.message };
    }
    return undefined;
  } catch {
    return undefined;
  }
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

export const restoreLogs = (value: unknown): LogEntry[] =>
  Array.isArray(value)
    ? value
        .flatMap((item): LogEntry[] =>
          typeof item === "object" &&
          item !== null &&
          "id" in item &&
          "time" in item &&
          "scriptName" in item &&
          "name" in item &&
          "message" in item &&
          "sequenceId" in item &&
          isText(item.id) &&
          typeof item.time === "number" &&
          isText(item.scriptName) &&
          isText(item.name) &&
          isText(item.message) &&
          isText(item.sequenceId)
            ? [
                {
                  id: item.id,
                  time: item.time,
                  scriptName: item.scriptName,
                  name: item.name,
                  message: item.message,
                  sequenceId: item.sequenceId,
                },
              ]
            : [],
        )
        .slice(-LOG_LIMIT)
    : [];
