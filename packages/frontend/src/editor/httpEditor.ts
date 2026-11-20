import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

import { STRUCK } from "@/requests/strike";

type Mark = { from: number; to: number; className: string };

const REQUEST_LINE = /^(\S+)(\s+)(\S+)(?:(\s+)(HTTP\/\d(?:\.\d)?))?/;
const HEADER = /^([^:\s][^:]*)(:)(.*)$/;
const JSON_STRING = /"(?:[^"\\]|\\.)*"(\s*:)?/g;
const JSON_NUMBER = /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g;
const JSON_ATOM = /\b(?:true|false|null)\b/g;
const PLACEHOLDER = /<[^<>\s]*>|\{[^{}\s]*\}/g;

const eachMatch = (
  pattern: RegExp,
  text: string,
  offset: number,
  visit: (start: number, match: RegExpMatchArray) => void,
) => {
  for (const match of text.matchAll(pattern)) {
    visit(offset + (match.index ?? 0), match);
  }
};

const marksFor = (view: EditorView): Mark[] => {
  const marks: Mark[] = [];
  const add = (from: number, to: number, className: string) => {
    if (to > from) marks.push({ from, to, className });
  };
  const doc = view.state.doc;
  let inBody = false;

  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    const text = line.text;

    if (number === 1) {
      const match = REQUEST_LINE.exec(text);
      if (match !== null) {
        const [, method = "", gap = "", target = "", space = "", version = ""] =
          match;
        add(line.from, line.from + method.length, "cm-http-method");
        const targetStart = line.from + method.length + gap.length;
        add(targetStart, targetStart + target.length, "cm-http-target");
        const versionStart = targetStart + target.length + space.length;
        add(versionStart, versionStart + version.length, "cm-http-version");
      }
    } else if (!inBody) {
      if (text === "") {
        inBody = true;
      } else {
        const match = HEADER.exec(text);
        if (match !== null) {
          const [, name = ""] = match;
          add(line.from, line.from + name.length, "cm-http-header-name");
          add(line.from + name.length + 1, line.to, "cm-http-header-value");
        }
      }
    } else {
      eachMatch(JSON_STRING, text, line.from, (start, match) => {
        const isKey = match[1] !== undefined;
        const end = start + match[0].length - (match[1]?.length ?? 0);
        add(start, end, isKey ? "cm-http-key" : "cm-http-string");
      });
      eachMatch(JSON_NUMBER, text, line.from, (start, match) =>
        add(start, start + match[0].length, "cm-http-number"),
      );
      eachMatch(JSON_ATOM, text, line.from, (start, match) =>
        add(start, start + match[0].length, "cm-http-atom"),
      );
    }

    eachMatch(PLACEHOLDER, text, line.from, (start, match) =>
      add(start, start + match[0].length, "cm-http-placeholder"),
    );
    eachMatch(STRUCK, text, line.from, (start, match) =>
      add(start, start + match[0].length, "cm-http-struck"),
    );
  }

  return marks;
};

const highlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = this.build(update.view);
    }

    build(view: EditorView): DecorationSet {
      return Decoration.set(
        marksFor(view).map((mark) =>
          Decoration.mark({ class: mark.className }).range(mark.from, mark.to),
        ),
        true,
      );
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const themeFor = (autoHeight: boolean) =>
  EditorView.theme(
    {
      "&": {
        height: autoHeight ? "auto" : "100%",
        width: "100%",
        maxWidth: "100%",
        backgroundColor: "#1d1f24",
        color: "#d4d7dd",
        fontSize: "13px",
        // Caido's app CSS disables selection on <body>; re-enable it here so text
        // in read-only panes (responses) can be highlighted and copied.
        userSelect: "text",
      },
      ".cm-scroller": {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        lineHeight: "1.5",
      },
      ".cm-content": { caretColor: "#f0a048", padding: "8px 0" },
      ".cm-gutters": {
        backgroundColor: "#1d1f24",
        color: "#5c616b",
        border: "none",
      },
      ".cm-activeLine": { backgroundColor: "#262930" },
      ".cm-activeLineGutter": { backgroundColor: "#262930" },
      "&.cm-focused": { outline: "none" },
      ".cm-cursor": { borderLeftColor: "#f0a048" },
      ".cm-http-method": { color: "#f0a048", fontWeight: "600" },
      ".cm-http-target": { color: "#e6e8ec" },
      ".cm-http-version": { color: "#6b7079" },
      ".cm-http-header-name": { color: "#7aa2f7" },
      ".cm-http-header-value": { color: "#a9b0bc" },
      ".cm-http-key": { color: "#7aa2f7" },
      ".cm-http-string": { color: "#98c379" },
      ".cm-http-number": { color: "#d19a66" },
      ".cm-http-atom": { color: "#c678dd" },
      ".cm-http-struck": {
        textDecoration: "line-through",
        color: "#6b7079",
      },
      ".cm-http-placeholder": {
        color: "#e5c07b",
        backgroundColor: "rgba(229, 192, 123, 0.12)",
        borderRadius: "2px",
      },
    },
    { dark: true },
  );

// Ctrl+Shift+X wraps the selection in ~~ markers, or unwraps it if it already has
// them. A selection over several lines is handled one line at a time, so every
// pair of markers stays on its own line. With no selection it applies to the
// whole line.
const toggleStrike = (view: EditorView): boolean => {
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.head);
  const from = range.empty ? line.from : range.from;
  let to = range.empty ? line.to : range.to;
  // A selection that ends at the start of a line does not reach into that line
  if (!range.empty && to > from && state.doc.lineAt(to).from === to) to -= 1;

  const segments: { from: number; to: number }[] = [];
  for (let number = state.doc.lineAt(from).number; ; number++) {
    const current = state.doc.line(number);
    if (current.from > to) break;
    const start = Math.max(from, current.from);
    const end = Math.min(to, current.to);
    if (end > start) segments.push({ from: start, to: end });
    if (current.to >= to) break;
  }
  if (segments.length === 0) return false;

  const isWrapped = (segment: { from: number; to: number }) => {
    const text = state.sliceDoc(segment.from, segment.to);
    return text.length >= 4 && text.startsWith("~~") && text.endsWith("~~");
  };
  const unwrap = segments.every(isWrapped);
  const changes: { from: number; to?: number; insert?: string }[] = [];
  for (const segment of segments) {
    if (unwrap) {
      changes.push({ from: segment.from, to: segment.from + 2 });
      changes.push({ from: segment.to - 2, to: segment.to });
    } else {
      changes.push({ from: segment.from, insert: "~~" });
      changes.push({ from: segment.to, insert: "~~" });
    }
  }
  view.dispatch({ changes });
  return true;
};

export type HttpEditor = {
  setText: (text: string) => void;
  getText: () => string;
  destroy: () => void;
};

// autoHeight sizes the editor to its text instead of filling its parent
export const createHttpEditor = (
  parent: HTMLElement,
  readOnly: boolean,
  autoHeight = false,
): HttpEditor => {
  const view = new EditorView({
    parent,
    extensions: [
      themeFor(autoHeight),
      highlightPlugin,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: "false" }),
      EditorView.editable.of(!readOnly),
      ...(readOnly
        ? []
        : [keymap.of([{ key: "Mod-Shift-x", run: toggleStrike }])]),
    ],
  });

  return {
    setText: (text: string) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    getText: () => view.state.doc.toString(),
    destroy: () => view.destroy(),
  };
};
