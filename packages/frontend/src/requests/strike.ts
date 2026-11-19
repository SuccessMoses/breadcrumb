// Text between ~~ markers on one line is struck out. The editor shows it crossed
// out, and rendering removes it, so it stays in the template as a note.
export const STRUCK = /~~[^\n]*?~~/g;

// A line holding only struck text is removed with its line break, so it leaves
// no blank line behind
const STRUCK_LINE = /^[ \t]*~~[^\n]*?~~[ \t]*(?:\r?\n|$)/gm;

export const stripStruck = (text: string): string =>
  text.replace(STRUCK_LINE, "").replace(STRUCK, "");
