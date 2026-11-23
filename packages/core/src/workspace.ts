import type { RequestTemplate, Sequence, SequenceStep } from "shared";

import {
  type Capture,
  fillCaptures,
  RESPONSE_DIVIDER,
  runCaptures,
  unmetNames,
} from "./captures";
import { displayPath } from "./display";
import {
  captureLines,
  dictValues,
  sendWhenRendered,
  stripNotes,
} from "./notes";
import { defaultRequest, expandTemplate } from "./renderRequest";
import { stringifySequence } from "./rules";
import {
  entriesFor,
  isMatch,
  LOG_LIMIT,
  type LogEntry,
  restoreLogs,
  restoreScripts,
  type Script,
  type ScriptRun,
} from "./scripts";
import {
  parseTemplatesJson,
  type TemplateItem,
  templatesToJson,
} from "./templateJson";
import { expandUploads } from "./uploads";

// Something read and written through .value, as a Vue ref is
export type Ref<T> = { value: T };

export type SendResult =
  { kind: "Ok"; value: string } | { kind: "Error"; error: string };

// What the workspace needs from the host it runs in: where saved state lives, how
// a request is sent and how a problem is shown to the user
export type Adapter = {
  // The saved state of the project, or undefined when none is saved
  load: () => unknown;
  save: (snapshot: WorkspaceState) => void;
  sendRaw: (raw: string) => Promise<SendResult>;
  notify: (message: string, options?: { variant: "error" }) => void;
  // Runs a function after a delay and returns a way to cancel it
  schedule: (run: () => void, delayMs: number) => () => void;
  // Runs a script's code with the input as its input, and returns what it
  // wrote to stdout. The adapter stops the script after 2 seconds.
  runScript: (code: string, input: string) => Promise<ScriptRun>;
};

type Collection = { id: string; name: string };

export const DEFAULT_COLLECTION_ID = "default";

// A tree is identified by its root sequence, which has no parent
type Tree = { id: string; name: string };

// Which items are folded shut in each view, saved with the project
type FoldKey = "requests" | "extend";
// Folded sequences are kept per tree: a subtree shares sequences with its main tree
type Folds = {
  requests: string[];
  tree: Record<string, string[]>;
  extend: string[];
};

export type WorkspaceState = {
  folds: Folds;
  templates: RequestTemplate[];
  sequences: Sequence[];
  trees: Tree[];
  selectedTreeId: string | undefined;
  selectedSequenceId: string | undefined;
  texts: Record<string, string>;
  collections: Collection[];
  templateCollection: Record<string, string>;
  scripts: Script[];
  logs: LogEntry[];
};

// Outcome of rendering one step: its text, its response if it was sent, and
// the values its captures produced. A failure stops the sequence it is in.
type Rendered = {
  request: string;
  // The error message when the request failed and the render went on anyway
  response: string | undefined;
  captured: Record<string, string[]>;
  choice: Record<string, string>;
  failure: string | undefined;
};

// A template renders to one request per combination of its {{name|*}} values,
// so a successful render can produce none (a value was missing) or several
type RenderResult =
  { kind: "ok"; results: Rendered[] } | { kind: "error"; message: string };

export type Rendering = { sequenceId: string; stepId: string };

const stepFrom = (
  templateId: string,
  template: string,
  result: Rendered,
): SequenceStep => ({
  id: newId(),
  templateId,
  template,
  request: result.request,
  response: result.response,
  captured: result.captured,
  choice: result.choice,
});

export type SequenceRow = {
  sequence: Sequence;
  depth: number;
};

export type CoreWorkspace = {
  state: WorkspaceState;
  exportBackup: () => string;
  importBackup: (
    text: string,
  ) =>
    | { kind: "ok"; templates: number; sequences: number }
    | { kind: "error"; message: string };
  // Derived from the state; the plugin wraps these so they update with it
  renderingsOf: () => Map<string, Rendering[]>;
  selectedSequenceOf: () => Sequence | undefined;
  rowsOf: () => SequenceRow[];
  // The requests a template would send from a sequence's steps, without sending them
  previewTemplate: (
    templateId: string,
    sequenceId?: string,
  ) => { kind: "ok"; requests: string[] } | { kind: "error"; message: string };
  // Saves the project after a short pause; call it after any change to the state
  scheduleSave: () => void;
  // Step to select the next time its sequence is opened, consumed by Sequences
  focusStep: Ref<string | undefined>;
  setFocusStep: (stepId: string | undefined) => void;
  consumeFocusStep: () => string | undefined;
  // Template to select the next time Requests is shown, consumed by Requests
  focusTemplate: Ref<string | undefined>;
  setFocusTemplate: (templateId: string | undefined) => void;
  consumeFocusTemplate: () => string | undefined;
  importTemplates: (templates: RequestTemplate[]) => {
    added: number;
    skipped: number;
  };
  addEmptyTemplate: () => string;
  exportTemplatesJson: () => string;
  importTemplatesJson: (
    text: string,
  ) =>
    | { kind: "ok"; created: number; updated: number }
    | { kind: "error"; message: string };
  // Resolves to an error message if rendering stopped, otherwise undefined
  extendSequence: (
    parentId: string,
    templateId: string,
  ) => Promise<string | undefined>;
  // Breadth-first growth from each source, with pruning on failure
  grow: (options: {
    sequenceIds: string[];
    templateIds: string[];
    generations: number;
    readyOnly: boolean;
    stopped: () => boolean;
  }) => Promise<{ created: number; pruned: number; stopped: boolean }>;
  deleteSequence: (id: string) => number;
  rerenderSequence: (id: string) => Promise<{
    sequences: number;
    steps: number;
    error: string | undefined;
  }>;
  // The {{name}} inputs of a template that no step of the sequence captured
  missingInputs: (templateId: string, sequenceId: string) => string[];
  selectSequence: (id: string) => void;
  selectTree: (id: string) => void;
  createTree: (name: string) => void;
  renameTree: (id: string, name: string) => void;
  deleteTree: (id: string) => number;
  makeSubtree: (id: string) => boolean;
  saveStepRequest: (
    sequenceId: string,
    stepId: string,
    request: string,
  ) => void;
  setStepTemplate: (
    sequenceId: string,
    stepId: string,
    template: string,
  ) => void;
  setFolded: (key: FoldKey, ids: string[]) => void;
  setTreeFolded: (treeId: string, ids: string[]) => void;
  saveStepResponse: (
    sequenceId: string,
    stepId: string,
    response: string,
  ) => void;
  collectionOf: (templateId: string) => string;
  createCollection: (name: string) => void;
  isCollectionEmpty: (collectionId: string) => boolean;
  deleteCollection: (collectionId: string) => void;
  createScript: () => string;
  updateScript: (
    scriptId: string,
    change: { name?: string; code?: string },
  ) => void;
  deleteScript: (scriptId: string) => void;
  clearLogs: () => void;
  moveTemplate: (templateId: string, collectionId: string) => void;
  templateText: (templateId: string) => string | undefined;
  setTemplateText: (templateId: string, text: string) => void;
  sequenceLabel: (sequence: Sequence) => string;
  sequenceMethod: (sequence: Sequence) => string | undefined;
  sequencePath: (sequence: Sequence) => string;
};

// A fresh object per workspace: shared maps would leak edits between projects
export const emptyState = (): WorkspaceState => ({
  folds: { requests: [], tree: {}, extend: [] },
  templates: [],
  sequences: [],
  trees: [],
  selectedTreeId: undefined,
  selectedSequenceId: undefined,
  texts: {},
  collections: [],
  templateCollection: {},
  scripts: [],
  logs: [],
});

const restoreFolds = (value: unknown): Folds => {
  const list = (key: FoldKey): string[] => {
    const found = hasKey(value, key) ? value[key] : undefined;
    return Array.isArray(found)
      ? found.filter((id): id is string => typeof id === "string")
      : [];
  };
  const treeValue = hasKey(value, "tree") ? value.tree : undefined;
  const tree =
    typeof treeValue === "object" &&
    treeValue !== null &&
    !Array.isArray(treeValue)
      ? Object.fromEntries(
          Object.entries(treeValue).flatMap(
            ([id, found]): [string, string[]][] =>
              Array.isArray(found)
                ? [
                    [
                      id,
                      found.filter((v): v is string => typeof v === "string"),
                    ],
                  ]
                : [],
          ),
        )
      : {};
  return {
    requests: list("requests"),
    tree,
    extend: list("extend"),
  };
};

const restoreTrees = (value: unknown): Tree[] =>
  Array.isArray(value)
    ? value.flatMap((item): Tree[] =>
        hasKey(item, "id") &&
        hasKey(item, "name") &&
        typeof item.id === "string" &&
        typeof item.name === "string"
          ? [{ id: item.id, name: item.name }]
          : [],
      )
    : [];

export const isState = (value: unknown): value is WorkspaceState =>
  typeof value === "object" &&
  value !== null &&
  "templates" in value &&
  Array.isArray(value.templates) &&
  "sequences" in value &&
  Array.isArray(value.sequences);

const newId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const hasKey = <K extends string>(
  value: unknown,
  key: K,
): value is Record<K, unknown> =>
  typeof value === "object" && value !== null && key in value;

const isStep = (value: unknown): value is SequenceStep =>
  hasKey(value, "id") &&
  hasKey(value, "templateId") &&
  hasKey(value, "request") &&
  typeof value.id === "string" &&
  typeof value.templateId === "string" &&
  typeof value.request === "string";

// Captured values were single strings before they became lists
const restoreCaptured = (
  value: unknown,
): Record<string, string[]> | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, found]): [string, string[]][] => {
      if (typeof found === "string") return [[name, [found]]];
      if (Array.isArray(found)) {
        return [
          [name, found.filter((v): v is string => typeof v === "string")],
        ];
      }
      return [];
    }),
  );
};

const restoreStep = (step: SequenceStep): SequenceStep => ({
  ...step,
  captured: restoreCaptured(step.captured),
  choice: step.choice === undefined ? undefined : restoreStrings(step.choice),
});

const restoreStrings = (value: unknown): Record<string, string> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};

const restoreCollections = (value: unknown): Collection[] =>
  Array.isArray(value)
    ? value.flatMap((item): Collection[] =>
        hasKey(item, "id") &&
        hasKey(item, "name") &&
        typeof item.id === "string" &&
        typeof item.name === "string"
          ? [{ id: item.id, name: item.name }]
          : [],
      )
    : [];

const restoreCaptures = (value: unknown): Capture[] =>
  Array.isArray(value)
    ? value.flatMap((item): Capture[] =>
        hasKey(item, "name") &&
        hasKey(item, "regex") &&
        typeof item.name === "string" &&
        typeof item.regex === "string"
          ? [{ name: item.name, regex: item.regex }]
          : [],
      )
    : [];

// Captures were kept per template before they moved into the template text
const restoreLegacyRules = (value: unknown): Record<string, Capture[]> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).flatMap(
          ([templateId, rule]): [string, Capture[]][] =>
            typeof rule === "object" && rule !== null
              ? [
                  [
                    templateId,
                    restoreCaptures(
                      hasKey(rule, "captures") ? rule.captures : undefined,
                    ),
                  ],
                ]
              : [],
        ),
      )
    : {};

// Adds lines to the end of a template text, leaving out any it already has
const appendLines = (text: string, lines: string[]): string => {
  const present = new Set(text.split("\n"));
  const added = lines.filter((line) => !present.has(line));
  if (added.length === 0) return text;
  const base = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  return `${base}${added.join("\n")}\n`;
};

const ROOT_NAME = "/";

const restoreSequences = (
  values: unknown[],
  templates: RequestTemplate[],
): Sequence[] =>
  values.flatMap((value) => {
    if (!hasKey(value, "id") || !hasKey(value, "name")) return [];
    if (typeof value.id !== "string" || typeof value.name !== "string")
      return [];
    const parentId =
      hasKey(value, "parentId") && typeof value.parentId === "string"
        ? value.parentId
        : undefined;
    if (
      hasKey(value, "steps") &&
      Array.isArray(value.steps) &&
      value.steps.every(isStep)
    ) {
      return [
        {
          id: value.id,
          name: value.name,
          parentId,
          steps: value.steps.map(restoreStep),
        },
      ];
    }
    if (hasKey(value, "templateIds") && Array.isArray(value.templateIds)) {
      const steps = value.templateIds.flatMap((templateId): SequenceStep[] => {
        if (typeof templateId !== "string") return [];
        const template = templates.find((t) => t.id === templateId);
        const request = template === undefined ? "" : defaultRequest(template);
        return [{ id: newId(), templateId, request, response: undefined }];
      });
      return [{ id: value.id, name: value.name, parentId, steps }];
    }
    return [];
  });

export const createCore = ({
  state,
  adapter,
  focusStep,
  focusTemplate,
  templatesById,
  sequencesById,
}: {
  state: WorkspaceState;
  adapter: Adapter;
  focusStep: Ref<string | undefined>;
  focusTemplate: Ref<string | undefined>;
  templatesById: Ref<Map<string, RequestTemplate>>;
  sequencesById: Ref<Map<string, Sequence>>;
}): CoreWorkspace => {
  const setFocusStep = (stepId: string | undefined) => {
    focusStep.value = stepId;
  };
  const consumeFocusStep = () => {
    const stepId = focusStep.value;
    focusStep.value = undefined;
    return stepId;
  };
  const setFocusTemplate = (templateId: string | undefined) => {
    focusTemplate.value = templateId;
  };
  const consumeFocusTemplate = () => {
    const templateId = focusTemplate.value;
    focusTemplate.value = undefined;
    return templateId;
  };
  // Replaces the state with saved data, from storage or a backup file. Data
  // that is not a saved state leaves the state as it is.
  const applySaved = (saved: unknown) => {
    if (isState(saved)) {
      state.templates = saved.templates;
      state.sequences = restoreSequences(saved.sequences, saved.templates);
      state.trees = restoreTrees(
        hasKey(saved, "trees") ? saved.trees : undefined,
      );
      state.folds = restoreFolds(
        hasKey(saved, "folds") ? saved.folds : undefined,
      );
      state.selectedTreeId =
        hasKey(saved, "selectedTreeId") &&
        typeof saved.selectedTreeId === "string"
          ? saved.selectedTreeId
          : undefined;
      state.selectedSequenceId =
        hasKey(saved, "selectedSequenceId") &&
        typeof saved.selectedSequenceId === "string"
          ? saved.selectedSequenceId
          : undefined;
      state.collections = restoreCollections(
        hasKey(saved, "collections") ? saved.collections : undefined,
      );
      state.templateCollection = restoreStrings(
        hasKey(saved, "templateCollection")
          ? saved.templateCollection
          : undefined,
      );
      state.texts = restoreStrings(
        hasKey(saved, "texts") ? saved.texts : undefined,
      );
      // Scripts saved in the rules language are not JavaScript, so they are dropped
      state.scripts =
        hasKey(saved, "scriptsLanguage") &&
        saved.scriptsLanguage === "javascript"
          ? restoreScripts(hasKey(saved, "scripts") ? saved.scripts : undefined)
          : [];
      state.logs = restoreLogs(hasKey(saved, "logs") ? saved.logs : undefined);
      // Captures still kept per template move into the template text, once.
      // Remove this when no project file has a rules entry left.
      const legacy = restoreLegacyRules(
        hasKey(saved, "rules") ? saved.rules : undefined,
      );
      for (const [templateId, captures] of Object.entries(legacy)) {
        const lines = captures.map(
          (capture) => `# \`\`dict ${capture.name} from ${capture.regex}`,
        );
        state.texts[templateId] = appendLines(
          state.texts[templateId] ?? "",
          lines,
        );
        for (const sequence of state.sequences) {
          for (const step of sequence.steps) {
            if (step.templateId === templateId && step.template !== undefined) {
              step.template = appendLines(step.template, lines);
            }
          }
        }
      }
    }

    // Every template starts in the Default collection, which always exists
    if (!state.collections.some((c) => c.id === DEFAULT_COLLECTION_ID)) {
      state.collections.unshift({ id: DEFAULT_COLLECTION_ID, name: "Default" });
    }
  };
  applySaved(adapter.load());

  // Saves the project after a short pause, so a burst of changes (such as a Grow
  // creating many sequences) is written once. Selection changes are not saved on
  // their own; the selection goes with the next save.
  const snapshot = () => ({
    templates: state.templates,
    sequences: state.sequences,
    trees: state.trees,
    folds: state.folds,
    selectedTreeId: state.selectedTreeId,
    selectedSequenceId: state.selectedSequenceId,
    texts: state.texts,
    collections: state.collections,
    templateCollection: state.templateCollection,
    scripts: state.scripts,
    scriptsLanguage: "javascript",
    logs: state.logs,
  });
  const save = () => adapter.save(snapshot());

  // A backup file holds the same data as storage, in a format with a version so
  // a later version of the plugin can tell what it is reading
  const BACKUP_FORMAT = "breadcrumb-backup";
  const exportBackup = (): string =>
    JSON.stringify(
      {
        format: BACKUP_FORMAT,
        version: 1,
        exportedAt: new Date().toISOString(),
        state: snapshot(),
      },
      null,
      2,
    );

  // Replaces this project's data with a backup file's. Nothing changes if the
  // file is not a Breadcrumb backup.
  const importBackup = (
    text: string,
  ):
    | { kind: "ok"; templates: number; sequences: number }
    | { kind: "error"; message: string } => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { kind: "error", message: "The file is not valid JSON" };
    }
    if (!hasKey(parsed, "format") || parsed.format !== BACKUP_FORMAT) {
      return { kind: "error", message: "This is not a Breadcrumb backup" };
    }
    if (!hasKey(parsed, "state") || !isState(parsed.state)) {
      return { kind: "error", message: "The backup holds no Breadcrumb data" };
    }
    const saved = parsed.state;
    applySaved(saved);
    ensureTrees();
    return {
      kind: "ok",
      templates: state.templates.length,
      sequences: state.sequences.length,
    };
  };
  // Each change restarts the pause, so a burst of changes is saved once
  let cancelSave: (() => void) | undefined;
  const scheduleSave = () => {
    cancelSave?.();
    cancelSave = adapter.schedule(save, 300);
  };

  // Every sequence below a root, the root included
  const treeMembers = (rootId: string): Set<string> => {
    const childrenOf = new Map<string, string[]>();
    for (const sequence of state.sequences) {
      if (sequence.parentId === undefined) continue;
      const siblings = childrenOf.get(sequence.parentId) ?? [];
      siblings.push(sequence.id);
      childrenOf.set(sequence.parentId, siblings);
    }
    const members = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined || members.has(id)) continue;
      members.add(id);
      stack.push(...(childrenOf.get(id) ?? []));
    }
    return members;
  };

  // Each parentless sequence is the root of one tree. A tree without a name
  // entry gets one, and an entry whose root is gone is dropped.
  const ensureTrees = () => {
    const roots = state.sequences.filter((s) => s.parentId === undefined);
    if (roots.length === 0) {
      state.sequences.push({
        id: newId(),
        name: ROOT_NAME,
        parentId: undefined,
        steps: [],
      });
    }
    for (const root of state.sequences) {
      if (root.parentId === undefined) root.name = ROOT_NAME;
    }
    // A tree's root is a parentless sequence or, for a subtree, any sequence
    const ids = new Set(state.sequences.map((s) => s.id));
    const trees = state.trees.filter((tree) => ids.has(tree.id));
    for (const root of state.sequences) {
      if (
        root.parentId === undefined &&
        !trees.some((tree) => tree.id === root.id)
      ) {
        trees.push({ id: root.id, name: `Tree ${trees.length + 1}` });
      }
    }
    state.trees = trees;
    if (!trees.some((tree) => tree.id === state.selectedTreeId)) {
      state.selectedTreeId = trees[0]?.id;
    }
    const inTree =
      state.selectedTreeId !== undefined &&
      treeMembers(state.selectedTreeId).has(state.selectedSequenceId ?? "");
    if (!inTree) state.selectedSequenceId = state.selectedTreeId;
  };
  ensureTrees();

  // Name each sequence after the alias of the template that created it (its
  // last step). Names are labels only; ids are what keep sequences apart.
  // Looked up per label; rebuilding this map per call made naming 2k
  // sequences quadratic
  // Sequences are kept in creation order, so the last entry is the newest
  // Fills the values in first, then gives every copy its own {random} values. A
  // fan-out over {{name|*}} therefore never gives two copies the same name.
  const fillTemplate = (
    text: string,
    before: SequenceStep[],
    fixed: Record<string, string> = {},
  ) =>
    fillCaptures(
      stripNotes(expandUploads(text)),
      valuesBefore(before, text),
      fixed,
    ).map((filling) => ({
      ...filling,
      request: expandTemplate(filling.request),
    }));

  const previewTemplate = (templateId: string, sequenceId?: string) => {
    const text = templateText(templateId);
    if (text === undefined) {
      return { kind: "error" as const, message: "No such template" };
    }
    const before =
      sequenceId === undefined
        ? []
        : (state.sequences.find((s) => s.id === sequenceId)?.steps ?? []);
    const fillings = fillTemplate(text, before);
    return {
      kind: "ok" as const,
      requests: fillings.map((filling) => filling.request),
    };
  };

  const renderingsOf = () => {
    const byTemplate = new Map<string, Rendering[]>();
    for (const sequence of state.sequences) {
      for (const step of sequence.steps) {
        const list = byTemplate.get(step.templateId) ?? [];
        list.push({ sequenceId: sequence.id, stepId: step.id });
        byTemplate.set(step.templateId, list);
      }
    }
    return byTemplate;
  };
  const selectedSequenceOf = () =>
    state.sequences.find((s) => s.id === state.selectedSequenceId);

  // Rows of the selected tree only: its root, then everything below it
  const rowsOf = (): SequenceRow[] => {
    const root = state.sequences.find((s) => s.id === state.selectedTreeId);
    if (root === undefined) return [];
    // Children grouped once, in the order they were created
    const childrenOf = new Map<string | undefined, Sequence[]>();
    for (const sequence of state.sequences) {
      const siblings = childrenOf.get(sequence.parentId);
      if (siblings === undefined) {
        childrenOf.set(sequence.parentId, [sequence]);
      } else {
        siblings.push(sequence);
      }
    }
    const walk = (parentId: string | undefined, depth: number): SequenceRow[] =>
      (childrenOf.get(parentId) ?? []).flatMap((sequence) => [
        { sequence, depth },
        ...walk(sequence.id, depth + 1),
      ]);
    return [{ sequence: root, depth: 0 }, ...walk(root.id, 1)];
  };

  // Appends the templates of a spec. A template already present (same method and
  // path) is skipped. Its request starts as the one the spec describes.
  const importTemplates = (templates: RequestTemplate[]) => {
    const known = new Set(state.templates.map((t) => t.id));
    let added = 0;
    for (const template of templates) {
      if (known.has(template.id)) continue;
      known.add(template.id);
      state.templates.push(template);
      state.texts[template.id] = defaultRequest(template);
      added += 1;
    }
    return { added, skipped: templates.length - added };
  };

  const collectionName = (templateId: string) =>
    state.collections.find((c) => c.id === collectionOf(templateId))?.name ??
    "";

  const exportTemplatesJson = () =>
    templatesToJson(
      state.templates.map((template) => ({
        template,
        collection: collectionName(template.id),
        text: state.texts[template.id] ?? "",
      })),
    );

  // The collection with this name, created if there is none. A blank name is Default.
  const collectionNamed = (name: string) => {
    const trimmed = name.trim();
    if (trimmed === "") return DEFAULT_COLLECTION_ID;
    const found = state.collections.find((c) => c.name === trimmed);
    if (found !== undefined) return found.id;
    const created = { id: newId(), name: trimmed };
    state.collections.push(created);
    return created.id;
  };

  // A request with the same method and path is overwritten, keeping its id;
  // any other request is created. Requests already in the project are never removed.
  const mergeTemplates = (items: TemplateItem[]) => {
    let created = 0;
    let updated = 0;
    for (const item of items) {
      const { collection, text, ...fields } = item;
      const collectionId = collectionNamed(collection);
      const existing = state.templates.find(
        (t) =>
          t.method.toUpperCase() === fields.method && t.path === fields.path,
      );
      if (existing !== undefined) {
        Object.assign(existing, fields);
        state.texts[existing.id] = text;
        state.templateCollection[existing.id] = collectionId;
        updated += 1;
      } else {
        const id = newId();
        state.templates.push({ ...fields, id });
        state.texts[id] = text;
        state.templateCollection[id] = collectionId;
        created += 1;
      }
    }
    return { created, updated };
  };

  const importTemplatesJson = (text: string) => {
    const parsed = parseTemplatesJson(text);
    if (parsed.kind === "error") return parsed;
    return { kind: "ok" as const, ...mergeTemplates(parsed.items) };
  };

  // A new request with nothing in it, to be filled by hand
  const addEmptyTemplate = () => {
    const template: RequestTemplate = {
      id: newId(),
      method: "",
      path: "",
      url: "",
      operationId: undefined,
      summary: undefined,
      parameters: [],
      body: undefined,
    };
    state.templates.push(template);
    state.texts[template.id] = "";
    return template.id;
  };

  // The values of each name a sequence has so far, as a set. They start from the
  // ``dict lines of its templates, so those values come first, and then the values
  // the steps before a step captured are added after them, in the order found.
  // current is the template text of the step being rendered, if it is not one of
  // the steps yet.
  const valuesBefore = (steps: SequenceStep[], current?: string) => {
    const texts = steps.map(
      (step) => step.template ?? templateText(step.templateId) ?? "",
    );
    if (current !== undefined) texts.push(current);
    const seeded = texts.reduce<Record<string, string[]>>((values, text) => {
      const merged = { ...values };
      for (const [name, declared] of Object.entries(dictValues(text))) {
        merged[name] = [...new Set([...(values[name] ?? []), ...declared])];
      }
      return merged;
    }, {});
    return steps.reduce<Record<string, string[]>>((values, step) => {
      const merged = { ...values };
      for (const [name, found] of Object.entries(step.captured ?? {})) {
        merged[name] = [...new Set([...(values[name] ?? []), ...found])];
      }
      return merged;
    }, seeded);
  };

  // Renders a template as the next step after the given steps: fills its
  // placeholders from them, then for each filling sends the request if the
  // template says so and runs its captures over the request (and response).
  const renderStep = async (
    text: string,
    templateId: string,
    before: SequenceStep[],
    fixed: Record<string, string> = {},
    softFailure = false,
  ): Promise<RenderResult> => {
    const fillings = fillTemplate(text, before, fixed);
    const captures = captureLines(text);

    const results: Rendered[] = [];
    for (const filling of fillings) {
      let response: string | undefined;
      let failure: string | undefined;
      // Whether this copy of the template is sent is set by its own command line
      if (sendWhenRendered(text)) {
        const sent = await adapter.sendRaw(filling.request);
        if (sent.kind === "Error") {
          if (!softFailure) return { kind: "error", message: sent.error };
          // The error stands in for the response, so the step still shows why
          failure = sent.error;
        }
        response = sent.kind === "Ok" ? sent.value : sent.error;
      }

      const subject =
        response === undefined
          ? filling.request
          : filling.request + RESPONSE_DIVIDER + response;
      // A failed request has no response for captures to read
      const result =
        failure === undefined
          ? runCaptures(captures, subject)
          : { kind: "ok" as const, values: {} };
      if (result.kind === "error") return result;
      results.push({
        request: filling.request,
        response,
        captured: result.values,
        choice: filling.choice,
        failure,
      });
    }
    return { kind: "ok", results };
  };

  const missingInputs = (templateId: string, sequenceId: string) => {
    const text = templateText(templateId);
    const sequence = state.sequences.find((s) => s.id === sequenceId);
    if (text === undefined || sequence === undefined) return [];
    return unmetNames(
      stripNotes(expandUploads(text)),
      valuesBefore(sequence.steps, text),
    );
  };

  // Creates one child of a sequence for each rendering of the template, without
  // selecting them or reporting errors. Nothing is taken from the parent: every step
  // of the sequence is rendered again from its template, in order, so each step
  // reads the values of the steps before it in this sequence. Rendering stops at
  // the first failure. A value that is missing creates no children.
  const extendOne = async (
    parentId: string,
    templateId: string,
  ): Promise<
    | { kind: "ok"; children: { id: string; failure: string | undefined }[] }
    | { kind: "error"; message: string }
  > => {
    const parent = state.sequences.find((s) => s.id === parentId);
    const template = templatesById.value.get(templateId);
    if (parent === undefined || template === undefined) {
      return { kind: "error", message: "Missing sequence or template" };
    }

    // Each step keeps the {{name|*}} value the parent had it on
    const prefix: SequenceStep[] = [];
    for (const inherited of parent.steps) {
      const text = inherited.template ?? templateText(inherited.templateId);
      if (text === undefined)
        return { kind: "error", message: "Missing template" };
      const rendered = await renderStep(
        text,
        inherited.templateId,
        prefix,
        inherited.choice,
      );
      if (rendered.kind === "error") return rendered;
      const first = rendered.results[0];
      if (first === undefined) return { kind: "ok", children: [] };
      prefix.push(stepFrom(inherited.templateId, text, first));
    }

    const text = templateText(templateId);
    if (text === undefined)
      return { kind: "error", message: "Missing template" };
    // A failed request still makes its child, with the error as the response
    const rendered = await renderStep(text, templateId, prefix, {}, true);
    if (rendered.kind === "error") return rendered;
    const children: { id: string; failure: string | undefined }[] = [];
    for (const result of rendered.results) {
      // Each sibling has its own step records, so none is shared between sequences
      const child: Sequence = {
        id: newId(),
        name: newId(),
        parentId,
        steps: [
          ...prefix.map((step) => ({ ...step, id: newId() })),
          stepFrom(templateId, text, result),
        ],
      };
      state.sequences.push(child);
      children.push({ id: child.id, failure: result.failure });
    }
    await logNewSequences(children.map((child) => child.id));
    return { kind: "ok", children };
  };

  // Extends one sequence and selects the new child. Resolves to an error message
  // if rendering stopped, otherwise undefined.
  const extendSequence = async (
    parentId: string,
    templateId: string,
  ): Promise<string | undefined> => {
    const result = await extendOne(parentId, templateId);
    if (result.kind === "error") {
      adapter.notify(result.message, { variant: "error" });
      return result.message;
    }
    const last = result.children[result.children.length - 1];
    if (last !== undefined) state.selectedSequenceId = last.id;
    const failures = result.children.flatMap((child) =>
      child.failure === undefined ? [] : [child.failure],
    );
    if (failures.length > 0) {
      adapter.notify(`${failures.length} request(s) failed: ${failures[0]}`, {
        variant: "error",
      });
    }
    return undefined;
  };

  // Breadth-first growth: each generation extends every sequence in the frontier
  // with each template. A child that fails is pruned, so its branch goes no
  // further. With readyOnly, a template is skipped where an input is missing.
  // Stops between requests when stopped() returns true.
  const grow = async (options: {
    sequenceIds: string[];
    templateIds: string[];
    generations: number;
    readyOnly: boolean;
    stopped: () => boolean;
  }): Promise<{ created: number; pruned: number; stopped: boolean }> => {
    let frontier = options.sequenceIds;
    let created = 0;
    let pruned = 0;
    for (let generation = 0; generation < options.generations; generation++) {
      const next: string[] = [];
      for (const parentId of frontier) {
        for (const templateId of options.templateIds) {
          if (options.stopped()) return { created, pruned, stopped: true };
          if (
            options.readyOnly &&
            missingInputs(templateId, parentId).length > 0
          ) {
            continue;
          }
          const result = await extendOne(parentId, templateId);
          if (result.kind === "error") {
            pruned += 1;
            continue;
          }
          // A failed child stays in the tree but is not extended further
          for (const child of result.children) {
            if (child.failure === undefined) {
              next.push(child.id);
              created += 1;
            } else {
              pruned += 1;
            }
          }
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }
    return { created, pruned, stopped: false };
  };

  // Deletes a sequence and everything under it. The root cannot be deleted.
  // Returns how many sequences were removed.
  const deleteSequence = (id: string) => {
    const target = state.sequences.find((s) => s.id === id);
    if (target === undefined || target.parentId === undefined) return 0;

    const doomed = new Set<string>();
    const collect = (sequenceId: string) => {
      doomed.add(sequenceId);
      for (const child of state.sequences) {
        if (child.parentId === sequenceId) collect(child.id);
      }
    };
    collect(id);

    if (
      state.selectedSequenceId !== undefined &&
      doomed.has(state.selectedSequenceId)
    ) {
      state.selectedSequenceId = target.parentId;
    }
    state.sequences = state.sequences.filter((s) => !doomed.has(s.id));
    return doomed.size;
  };

  const selectTree = (id: string) => {
    if (!state.trees.some((tree) => tree.id === id)) return;
    state.selectedTreeId = id;
    state.selectedSequenceId = id;
  };

  const createTree = (name: string) => {
    const root: Sequence = {
      id: newId(),
      name: ROOT_NAME,
      parentId: undefined,
      steps: [],
    };
    state.sequences.push(root);
    state.trees.push({ id: root.id, name });
    selectTree(root.id);
  };

  const renameTree = (id: string, name: string) => {
    const tree = state.trees.find((t) => t.id === id);
    if (tree !== undefined && name.trim() !== "") tree.name = name.trim();
  };

  // The last tree cannot be deleted. Returns how many sequences were removed.
  // Deleting a subtree only removes the view: its sequences stay in the tree
  // they belong to. Returns how many sequences were removed.
  const deleteTree = (id: string) => {
    if (state.trees.length <= 1) return 0;
    const root = state.sequences.find((s) => s.id === id);
    const isSubtree = root?.parentId !== undefined;
    const doomed = isSubtree ? new Set<string>() : treeMembers(id);
    state.sequences = state.sequences.filter((s) => !doomed.has(s.id));
    state.trees = state.trees.filter((tree) => tree.id !== id);
    if (state.selectedTreeId === id) selectTree(state.trees[0]?.id ?? "");
    return doomed.size;
  };

  // A subtree is a view on a sequence and everything under it. Nothing is copied:
  // changes made in either tree show in both. Returns false when it cannot be made.
  const makeSubtree = (id: string): boolean => {
    const node = state.sequences.find((s) => s.id === id);
    if (node === undefined || node.parentId === undefined) return false;
    if (state.trees.some((tree) => tree.id === id)) return false;
    state.trees.push({ id, name: `Subtree ${state.trees.length + 1}` });
    selectTree(id);
    return true;
  };

  const selectSequence = (id: string) => {
    state.selectedSequenceId = id;
  };

  // Regenerates the request of every step in a sequence and everything under it
  // from its template, with fresh {random} values. Hand-edited requests are
  // replaced and their responses dropped, since they no longer match. Steps
  // whose template is gone are left alone. Returns what was touched.
  // Each sequence is rendered from its own steps, in order, so the values a
  // step consumes always come from the steps before it in that sequence.
  const rerenderSequence = async (id: string) => {
    const targets = new Set<string>();
    const collect = (sequenceId: string) => {
      targets.add(sequenceId);
      for (const child of state.sequences) {
        if (child.parentId === sequenceId) collect(child.id);
      }
    };
    collect(id);

    let steps = 0;
    let sequences = 0;
    for (const sequence of state.sequences) {
      if (!targets.has(sequence.id)) continue;
      let changed = false;
      for (const [index, step] of sequence.steps.entries()) {
        // Each step renders its own copy of the template, not the request template
        const text = step.template ?? templateText(step.templateId);
        if (text === undefined) continue;
        // The step keeps the {{name|*}} values it was rendered with
        const rendered = await renderStep(
          text,
          step.templateId,
          sequence.steps.slice(0, index),
          step.choice,
        );
        if (rendered.kind === "error") {
          adapter.notify(rendered.message, { variant: "error" });
          return { sequences, steps, error: rendered.message };
        }
        const [first] = rendered.results;
        if (first === undefined) {
          const message = "A value this step needs is missing";
          adapter.notify(message, { variant: "error" });
          return { sequences, steps, error: message };
        }
        step.request = first.request;
        step.response = first.response;
        step.captured = first.captured;
        steps += 1;
        changed = true;
      }
      if (changed) sequences += 1;
    }
    return { sequences, steps, error: undefined };
  };

  const findStep = (sequenceId: string, stepId: string) =>
    state.sequences
      .find((s) => s.id === sequenceId)
      ?.steps.find((s) => s.id === stepId);

  // Records which items are folded in a view, so the next start shows the same
  const setFolded = (key: FoldKey, ids: string[]) => {
    state.folds = { ...state.folds, [key]: ids };
  };

  const setTreeFolded = (treeId: string, ids: string[]) => {
    state.folds = {
      ...state.folds,
      tree: { ...state.folds.tree, [treeId]: ids },
    };
  };

  // Edits the template copy a step is rendered from; Rerender applies it
  const setStepTemplate = (
    sequenceId: string,
    stepId: string,
    template: string,
  ) => {
    const step = findStep(sequenceId, stepId);
    if (step !== undefined) step.template = template;
  };

  const saveStepRequest = (
    sequenceId: string,
    stepId: string,
    request: string,
  ) => {
    const step = findStep(sequenceId, stepId);
    if (step === undefined) return;
    step.request = request;
  };

  const saveStepResponse = (
    sequenceId: string,
    stepId: string,
    response: string,
  ) => {
    const step = findStep(sequenceId, stepId);
    if (step === undefined) return;
    step.response = response;
  };

  const collectionOf = (templateId: string) => {
    const id = state.templateCollection[templateId];
    return id !== undefined && state.collections.some((c) => c.id === id)
      ? id
      : DEFAULT_COLLECTION_ID;
  };

  const createCollection = (name: string) => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    state.collections.push({ id: newId(), name: trimmed });
  };

  // A collection can only be deleted once no request is in it; Default never goes
  const isCollectionEmpty = (collectionId: string) =>
    state.templates.every((t) => collectionOf(t.id) !== collectionId);

  const deleteCollection = (collectionId: string) => {
    if (collectionId === DEFAULT_COLLECTION_ID) return;
    if (!isCollectionEmpty(collectionId)) return;
    state.collections = state.collections.filter((c) => c.id !== collectionId);
  };

  // A new script with no code, named by its place in the list
  const createScript = () => {
    const id = newId();
    state.scripts.push({
      id,
      name: `Script ${state.scripts.length + 1}`,
      code: "",
    });
    return id;
  };

  const updateScript = (
    scriptId: string,
    change: { name?: string; code?: string },
  ) => {
    const script = state.scripts.find((s) => s.id === scriptId);
    if (script === undefined) return;
    if (change.name !== undefined && change.name.trim() !== "") {
      script.name = change.name.trim();
    }
    if (change.code !== undefined) script.code = change.code;
  };

  const deleteScript = (scriptId: string) => {
    state.scripts = state.scripts.filter((s) => s.id !== scriptId);
  };

  const clearLogs = () => {
    state.logs = [];
  };

  // Runs the scripts over each sequence just created, in order. Each script's
  // stdout becomes log entries. The first script that logs a match for a
  // sequence stops the scripts for it.
  const logNewSequences = async (sequenceIds: string[]) => {
    const scripts = [...state.scripts];
    for (const sequenceId of sequenceIds) {
      const sequence = state.sequences.find((s) => s.id === sequenceId);
      if (sequence === undefined) continue;
      const input = stringifySequence(sequence);
      for (const script of scripts) {
        if (script.code.trim() === "") continue;
        const run = await adapter.runScript(script.code, input);
        const entries = entriesFor(script.name, sequenceId, run);
        const time = Date.now();
        for (const entry of entries) {
          state.logs.push({ id: newId(), time, ...entry });
        }
        if (isMatch(entries)) break;
      }
    }
    if (state.logs.length > LOG_LIMIT) {
      state.logs.splice(0, state.logs.length - LOG_LIMIT);
    }
  };

  const moveTemplate = (templateId: string, collectionId: string) => {
    state.templateCollection[templateId] = collectionId;
  };

  // The editable template text: the saved override, or the default request
  const templateText = (templateId: string) => {
    const template = templatesById.value.get(templateId);
    if (template === undefined) return undefined;
    return state.texts[templateId] ?? "";
  };

  // The method and path shown for a template follow its request line
  const setTemplateText = (templateId: string, text: string) => {
    state.texts[templateId] = text;
    const template = templatesById.value.get(templateId);
    const line = /^[ \t]*([A-Z]+)[ \t]+(\S+)/m.exec(stripNotes(text));
    if (template !== undefined && line !== null) {
      template.method = line[1] ?? "";
      template.path = line[2] ?? "";
    }
  };

  // The method and path of the template a sequence's last step came from
  const sequenceTemplate = (sequence: Sequence) => {
    const last = sequence.steps[sequence.steps.length - 1];
    return last === undefined
      ? undefined
      : templatesById.value.get(last.templateId);
  };
  const sequenceMethod = (sequence: Sequence) =>
    sequenceTemplate(sequence)?.method;
  const sequencePath = (sequence: Sequence) => {
    const template = sequenceTemplate(sequence);
    return template === undefined ? sequence.name : displayPath(template);
  };
  // Its own name, preceded by up to two ancestors' names, each shortened to its
  // first 8 characters: 3f2a9c1e-7b0d4e21-a09c3d5f. The root is not part of a name.
  const sequenceLabel = (sequence: Sequence) => {
    const byId = sequencesById.value;
    const names = [sequence.name];
    let parentId = sequence.parentId;
    while (parentId !== undefined) {
      const parent = byId.get(parentId);
      if (parent === undefined || parent.parentId === undefined) break;
      names.unshift(parent.name);
      parentId = parent.parentId;
    }
    return names
      .slice(-3)
      .map((name) => name.slice(0, 8))
      .join("-");
  };

  return {
    state,
    previewTemplate,
    renderingsOf,
    selectedSequenceOf,
    rowsOf,
    scheduleSave,
    focusStep,
    setFocusStep,
    consumeFocusStep,
    focusTemplate,
    setFocusTemplate,
    consumeFocusTemplate,
    importTemplates,
    exportBackup,
    importBackup,
    extendSequence,
    grow,
    deleteSequence,
    rerenderSequence,
    missingInputs,
    selectSequence,
    selectTree,
    createTree,
    renameTree,
    deleteTree,
    makeSubtree,
    setStepTemplate,
    setFolded,
    setTreeFolded,
    saveStepRequest,
    saveStepResponse,
    collectionOf,
    createCollection,
    isCollectionEmpty,
    deleteCollection,
    createScript,
    updateScript,
    deleteScript,
    clearLogs,
    moveTemplate,
    templateText,
    setTemplateText,
    addEmptyTemplate,
    exportTemplatesJson,
    importTemplatesJson,
    sequenceLabel,
    sequenceMethod,
    sequencePath,
  };
};
