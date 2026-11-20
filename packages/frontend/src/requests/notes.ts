// Notes in a request template, kept in the template but not sent.
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

export const stripNotes = (text: string): string =>
  text.replace(COMMENT_LINE, "").replace(STRUCK_LINE, "").replace(STRUCK, "");
