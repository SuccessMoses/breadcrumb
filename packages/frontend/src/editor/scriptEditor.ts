import { history, historyKeymap } from "@codemirror/commands";
import { Annotation, EditorState } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

// One pass over the text: each alternative is one kind of token, and the first
// alternative that matches at a position wins, so a regex or a string is never
// read as code inside it
const TOKEN =
  /`[^`]*`|"(?:[^"\\]|\\.)*"|\b(?:var|rule)\b|\b(?:AND|OR)\b|\b(?:node|children|delete)(?=\s*\()|\b(?:name|message)(?=\s*=)|\b[A-Za-z_][A-Za-z0-9_]*(?=\s*=)|;/g;

const classFor = (token: string): string => {
  if (token.startsWith("`")) return "cm-script-regex";
  if (token.startsWith('"')) return "cm-script-string";
  if (token === "var" || token === "rule") return "cm-script-keyword";
  if (token === "AND" || token === "OR") return "cm-script-operator";
  if (token === "node" || token === "children" || token === "delete") {
    return "cm-script-function";
  }
  if (token === "name" || token === "message") return "cm-script-attribute";
  if (token === ";") return "cm-script-punct";
  return "cm-script-name";
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
      const ranges = [];
      const text = view.state.doc.toString();
      for (const match of text.matchAll(TOKEN)) {
        const from = match.index ?? 0;
        ranges.push(
          Decoration.mark({ class: classFor(match[0]) }).range(
            from,
            from + match[0].length,
          ),
        );
      }
      return Decoration.set(ranges, true);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const theme = EditorView.theme(
  {
    "&": {
      height: "100%",
      width: "100%",
      backgroundColor: "#1d1f24",
      color: "#d4d7dd",
      fontSize: "13px",
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
    ".cm-script-keyword": { color: "#c678dd", fontWeight: "600" },
    ".cm-script-operator": { color: "#c678dd" },
    ".cm-script-function": { color: "#7aa2f7" },
    ".cm-script-attribute": { color: "#e5c07b" },
    ".cm-script-name": { color: "#e6e8ec" },
    ".cm-script-string": { color: "#98c379" },
    ".cm-script-regex": {
      color: "#f0a048",
      backgroundColor: "rgba(240, 160, 72, 0.12)",
      borderRadius: "2px",
    },
    ".cm-script-punct": { color: "#6b7079" },
  },
  { dark: true },
);

// Set on the edits the view makes when a script is loaded, so they are not
// reported back as the person's own edits
const external = Annotation.define<boolean>();

export type ScriptEditor = {
  setText: (text: string) => void;
  focus: () => void;
  destroy: () => void;
};

export const createScriptEditor = (
  parent: HTMLElement,
  onEdit: (text: string) => void,
): ScriptEditor => {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: "",
      extensions: [
        history(),
        keymap.of(historyKeymap),
        EditorView.lineWrapping,
        highlightPlugin,
        theme,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          if (
            update.transactions.some((tr) => tr.annotation(external) === true)
          ) {
            return;
          }
          onEdit(update.state.doc.toString());
        }),
      ],
    }),
  });

  return {
    setText: (text) => {
      if (view.state.doc.toString() === text) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: external.of(true),
      });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
};
