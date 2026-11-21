// Notes in a request template, kept in the template but not sent. A comment line
// whose text starts with two backticks is a command, e.g. # ``set send_when_rendered = false.
// Text between ~~ markers on one line is struck out: the editor crosses it out and
// rendering removes it. A line starting with "# " is a comment: the editor colours
// it green and rendering removes the whole line. A "#" not followed by a space,
// such as #fff or #channel, is ordinary text.
export const STRUCK = /~~[^\n]*?~~/g;

// A line holding only struck text is removed with its line break, so it leaves
// no blank line behind
const STRUCK_LINE = /^[ \t]*~~[^\n]*?~~[ \t]*(?:\r?\n|$)/gm;
const COMMENT_LINE = /^[ \t]*#(?: [^\n]*)?(?:\r?\n|$)/gm;
const COMMENT = /^[ \t]*#(?: |$)/;

export const isComment = (line: string): boolean => COMMENT.test(line);

// ``set name = value sets a setting of the template, e.g. ``set send_when_rendered = false
const SETTING =
  /^[ \t]*#[ \t]*``set[ \t]+([A-Za-z_]\w*)[ \t]*=[ \t]*(\S*)[ \t]*$/;
// ``dict name = a, b, c seeds the values of a name, before any step captures one
const DICT = /^[ \t]*#[ \t]*``dict[ \t]+([A-Za-z_]\w*)[ \t]*=(.*)$/;

export const isCommand = (line: string): boolean =>
  SETTING.test(line) || DICT.test(line);

// Whether a template is sent while it is rendered. The last send_when_rendered
// setting wins; without one the template is sent.
export const sendWhenRendered = (text: string): boolean => {
  let send = true;
  for (const line of text.split("\n")) {
    const match = SETTING.exec(line.replace(/\r$/, ""));
    if (match?.[1] === "send_when_rendered") {
      send = (match[2] ?? "").toLowerCase() !== "false";
    }
  }
  return send;
};

// The values each ``dict line of a template declares, by name. Several lines for
// one name are joined, keeping the order they were written in.
export const dictValues = (text: string): Record<string, string[]> => {
  const declared: Record<string, string[]> = {};
  for (const line of text.split("\n")) {
    const match = DICT.exec(line.replace(/\r$/, ""));
    if (match === null) continue;
    const name = match[1] ?? "";
    const values = (match[2] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value !== "");
    declared[name] = [...new Set([...(declared[name] ?? []), ...values])];
  }
  return declared;
};

export const stripNotes = (text: string): string =>
  text.replace(COMMENT_LINE, "").replace(STRUCK_LINE, "").replace(STRUCK, "");
