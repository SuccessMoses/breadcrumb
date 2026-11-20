// Notes in a request template, kept in the template but not sent. A comment line
// whose text starts with two backticks is a command, e.g. # ``send_when_rendered: false.
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

const COMMAND = /^[ \t]*#[ \t]*``([A-Za-z_]\w*)[ \t]*:[ \t]*(\S*)[ \t]*$/;

export const isCommand = (line: string): boolean => COMMAND.test(line);

// Whether a template is sent while it is rendered. The last send_when_rendered
// command wins; without one the template is sent.
export const sendWhenRendered = (text: string): boolean => {
  let send = true;
  for (const line of text.split("\n")) {
    const match = COMMAND.exec(line.replace(/\r$/, ""));
    if (match?.[1] === "send_when_rendered") {
      send = (match[2] ?? "").toLowerCase() !== "false";
    }
  }
  return send;
};

export const stripNotes = (text: string): string =>
  text.replace(COMMENT_LINE, "").replace(STRUCK_LINE, "").replace(STRUCK, "");
