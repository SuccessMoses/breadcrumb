// Text between ~~ markers on one line is struck out. The editor shows it crossed
// out, and rendering removes it, so it stays in the template as a note.
export const STRUCK = /~~[^\n]*?~~/g;

export const stripStruck = (text: string): string => text.replace(STRUCK, "");
