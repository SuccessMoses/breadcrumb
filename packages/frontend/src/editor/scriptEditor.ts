import { history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Annotation, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#c678dd", fontWeight: "600" },
  { tag: [tags.string, tags.special(tags.string)], color: "#98c379" },
  { tag: [tags.number, tags.bool, tags.null], color: "#d19a66" },
  { tag: tags.regexp, color: "#f0a048" },
  { tag: tags.comment, color: "#5c616b", fontStyle: "italic" },
  { tag: tags.function(tags.variableName), color: "#7aa2f7" },
  { tag: tags.propertyName, color: "#e5c07b" },
  { tag: [tags.operator, tags.punctuation], color: "#6b7079" },
]);

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
        javascript(),
        syntaxHighlighting(highlight),
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
