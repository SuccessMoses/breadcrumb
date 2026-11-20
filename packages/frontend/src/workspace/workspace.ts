import type { RequestTemplate, Sequence, SequenceStep } from "shared";
import {
  computed,
  type ComputedRef,
  reactive,
  ref,
  type Ref,
  watch,
} from "vue";

import {
  type Capture,
  fillCaptures,
  NO_RULE,
  RESPONSE_DIVIDER,
  runCaptures,
  type TemplateRule,
  unmetNames,
} from "./captures";

import { displayPath } from "@/requests/display";
import { sendWhenRendered, stripNotes } from "@/requests/notes";
import { defaultRequest, expandTemplate } from "@/requests/renderRequest";
import type { FrontendSDK } from "@/types";

type Collection = { id: string; name: string };

const DEFAULT_COLLECTION_ID = "default";

// A tree is identified by its root sequence, which has no parent
type Tree = { id: string; name: string };

// Which items are folded shut in each view, saved with the project
type FoldKey = "requests" | "tree" | "extend";
type Folds = Record<FoldKey, string[]>;

type WorkspaceState = {
  folds: Folds;
  templates: RequestTemplate[];
  sequences: Sequence[];
  trees: Tree[];
  selectedTreeId: string | undefined;
  selectedSequenceId: string | undefined;
  texts: Record<string, string>;
  collections: Collection[];
  templateCollection: Record<string, string>;
  rules: Record<string, TemplateRule>;
};

// Outcome of rendering one step: its text, its response if it was sent, and
// the values its captures produced. A failure stops the sequence it is in.
type Rendered = {
  request: string;
  response: string | undefined;
  captured: Record<string, string[]>;
  choice: Record<string, string>;
};

// A template renders to one request per combination of its {{name|*}} values,
// so a successful render can produce none (a value was missing) or several
type RenderResult =
  { kind: "ok"; results: Rendered[] } | { kind: "error"; message: string };

type Rendering = { sequenceId: string; stepId: string };

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

type SequenceRow = {
  sequence: Sequence;
  depth: number;
};

export type Workspace = {
  state: WorkspaceState;
  templatesById: ComputedRef<Map<string, RequestTemplate>>;
  // Every step rendered from a template, oldest first
  renderings: ComputedRef<Map<string, Rendering[]>>;
  selectedSequence: ComputedRef<Sequence | undefined>;
  rows: ComputedRef<SequenceRow[]>;
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
  ruleOf: (templateId: string) => TemplateRule;
  // The {{name}} inputs of a template that no step of the sequence captured
  missingInputs: (templateId: string, sequenceId: string) => string[];
  setRule: (templateId: string, rule: TemplateRule) => void;
  selectSequence: (id: string) => void;
  selectTree: (id: string) => void;
  createTree: (name: string) => void;
  renameTree: (id: string, name: string) => void;
  deleteTree: (id: string) => number;
  makeSubtree: (id: string) => boolean;
  highlighted: Ref<string[]>;
  setHighlighted: (ids: string[]) => void;
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
  saveStepResponse: (
    sequenceId: string,
    stepId: string,
    response: string,
  ) => void;
  collectionOf: (templateId: string) => string;
  createCollection: (name: string) => void;
  moveTemplate: (templateId: string, collectionId: string) => void;
  templateText: (templateId: string) => string | undefined;
  setTemplateText: (templateId: string, text: string) => void;
  sequenceLabel: (sequence: Sequence) => string;
  sequenceMethod: (sequence: Sequence) => string | undefined;
  sequencePath: (sequence: Sequence) => string;
};

// A fresh object per workspace: shared maps would leak edits between projects
const emptyState = (): WorkspaceState => ({
  folds: { requests: [], tree: [], extend: [] },
  templates: [],
  sequences: [],
  trees: [],
  selectedTreeId: undefined,
  selectedSequenceId: undefined,
  texts: {},
  collections: [],
  templateCollection: {},
  rules: {},
});

const restoreFolds = (value: unknown): Folds => {
  const list = (key: FoldKey): string[] => {
    const found = hasKey(value, key) ? value[key] : undefined;
    return Array.isArray(found)
      ? found.filter((id): id is string => typeof id === "string")
      : [];
  };
  return {
    requests: list("requests"),
    tree: list("tree"),
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

const isState = (value: unknown): value is WorkspaceState =>
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

const restoreRules = (value: unknown): Record<string, TemplateRule> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).flatMap(
          ([templateId, rule]): [string, TemplateRule][] =>
            typeof rule === "object" && rule !== null
              ? [
                  [
                    templateId,
                    {
                      captures: restoreCaptures(
                        hasKey(rule, "captures") ? rule.captures : undefined,
                      ),
                    },
                  ],
                ]
              : [],
        ),
      )
    : {};

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

// Storage holds one snapshot per Caido project, under "projects"
const readRoot = (sdk: FrontendSDK): Record<string, unknown> => {
  const value = sdk.storage.get();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
};

// Each entry is checked by isState before it is used
const readProjects = (
  root: Record<string, unknown>,
): Record<string, WorkspaceState> => {
  const value = root.projects;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
};

export const createWorkspace = (
  sdk: FrontendSDK,
  projectId: string,
): Workspace => {
  const root = readRoot(sdk);
  // Data saved before projects existed is adopted by the project opened first
  const legacy = !("projects" in root) && isState(root);
  const stored = legacy ? root : readProjects(root)[projectId];
  const state = reactive<WorkspaceState>(emptyState());
  const focusStep = ref<string>();
  const setFocusStep = (stepId: string | undefined) => {
    focusStep.value = stepId;
  };
  const consumeFocusStep = () => {
    const stepId = focusStep.value;
    focusStep.value = undefined;
    return stepId;
  };
  const focusTemplate = ref<string>();
  const setFocusTemplate = (templateId: string | undefined) => {
    focusTemplate.value = templateId;
  };
  const consumeFocusTemplate = () => {
    const templateId = focusTemplate.value;
    focusTemplate.value = undefined;
    return templateId;
  };
  if (isState(stored)) {
    state.templates = stored.templates;
    state.sequences = restoreSequences(stored.sequences, stored.templates);
    state.trees = restoreTrees(
      hasKey(stored, "trees") ? stored.trees : undefined,
    );
    state.folds = restoreFolds(
      hasKey(stored, "folds") ? stored.folds : undefined,
    );
    state.selectedTreeId =
      hasKey(stored, "selectedTreeId") &&
      typeof stored.selectedTreeId === "string"
        ? stored.selectedTreeId
        : undefined;
    state.selectedSequenceId =
      hasKey(stored, "selectedSequenceId") &&
      typeof stored.selectedSequenceId === "string"
        ? stored.selectedSequenceId
        : undefined;
    state.collections = restoreCollections(
      hasKey(stored, "collections") ? stored.collections : undefined,
    );
    state.templateCollection = restoreStrings(
      hasKey(stored, "templateCollection")
        ? stored.templateCollection
        : undefined,
    );
    state.texts = restoreStrings(
      hasKey(stored, "texts") ? stored.texts : undefined,
    );
    state.rules = restoreRules(
      hasKey(stored, "rules") ? stored.rules : undefined,
    );
  }

  // Every template starts in the Default collection, which always exists
  if (!state.collections.some((c) => c.id === DEFAULT_COLLECTION_ID)) {
    state.collections.unshift({ id: DEFAULT_COLLECTION_ID, name: "Default" });
  }

  // Saves the project after a short pause, so a burst of changes (such as a Grow
  // creating many sequences) is written once. Selection changes are not saved on
  // their own; the selection goes with the next save.
  let saveTimer: number | undefined;
  const save = () => {
    const current = readRoot(sdk);
    // Keep the other keys (such as settings) that share the storage root
    sdk.storage.set({
      ...current,
      projects: {
        ...readProjects(current),
        [projectId]: {
          templates: state.templates,
          sequences: state.sequences,
          trees: state.trees,
          folds: state.folds,
          selectedTreeId: state.selectedTreeId,
          selectedSequenceId: state.selectedSequenceId,
          texts: state.texts,
          collections: state.collections,
          templateCollection: state.templateCollection,
          rules: state.rules,
        },
      },
    });
  };
  watch(
    () => [
      state.templates,
      state.sequences,
      state.trees,
      state.folds,
      state.texts,
      state.collections,
      state.templateCollection,
      state.rules,
    ],
    () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 300);
    },
    { deep: true },
  );

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
  const templatesById = computed(
    () => new Map(state.templates.map((t) => [t.id, t])),
  );
  // Looked up per label; rebuilding this map per call made naming 2k highlighted
  // sequences quadratic
  const sequencesById = computed(() => {
    const byId = new Map<string, Sequence>();
    for (const sequence of state.sequences) byId.set(sequence.id, sequence);
    return byId;
  });
  // Sequences are kept in creation order, so the last entry is the newest
  const renderings = computed(() => {
    const byTemplate = new Map<string, Rendering[]>();
    for (const sequence of state.sequences) {
      for (const step of sequence.steps) {
        const list = byTemplate.get(step.templateId) ?? [];
        list.push({ sequenceId: sequence.id, stepId: step.id });
        byTemplate.set(step.templateId, list);
      }
    }
    return byTemplate;
  });
  const selectedSequence = computed(() =>
    state.sequences.find((s) => s.id === state.selectedSequenceId),
  );

  // Rows of the selected tree only: its root, then everything below it
  const rows = computed<SequenceRow[]>(() => {
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
  });

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
      auth: undefined,
    };
    state.templates.push(template);
    state.texts[template.id] = "";
    return template.id;
  };

  // The values the steps before a step captured, per name, merged as a set in the
  // order they were first found. A name captured by several steps has all of them.
  const valuesBefore = (steps: SequenceStep[]) =>
    steps.reduce<Record<string, string[]>>((values, step) => {
      const merged = { ...values };
      for (const [name, found] of Object.entries(step.captured ?? {})) {
        merged[name] = [...new Set([...(values[name] ?? []), ...found])];
      }
      return merged;
    }, {});

  // Renders a template as the next step after the given steps: fills its
  // placeholders from them, then for each filling sends the request if the
  // template says so and runs its captures over the request (and response).
  const renderStep = async (
    text: string,
    templateId: string,
    before: SequenceStep[],
    fixed: Record<string, string> = {},
  ): Promise<RenderResult> => {
    const fillings = fillCaptures(
      expandTemplate(text),
      valuesBefore(before),
      fixed,
    );
    const rule = state.rules[templateId] ?? NO_RULE;

    const results: Rendered[] = [];
    for (const filling of fillings) {
      let response: string | undefined;
      // Whether this copy of the template is sent is set by its own command line
      if (sendWhenRendered(text)) {
        const sent = await sdk.backend.sendRaw(filling.request);
        if (sent.kind === "Error")
          return { kind: "error", message: sent.error };
        response = sent.value;
      }

      const subject =
        response === undefined
          ? filling.request
          : filling.request + RESPONSE_DIVIDER + response;
      const result = runCaptures(rule.captures, subject);
      if (result.kind === "error") return result;
      results.push({
        request: filling.request,
        response,
        captured: result.values,
        choice: filling.choice,
      });
    }
    return { kind: "ok", results };
  };

  const missingInputs = (templateId: string, sequenceId: string) => {
    const text = templateText(templateId);
    const sequence = state.sequences.find((s) => s.id === sequenceId);
    if (text === undefined || sequence === undefined) return [];
    return unmetNames(stripNotes(text), valuesBefore(sequence.steps));
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
    { kind: "ok"; ids: string[] } | { kind: "error"; message: string }
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
      if (first === undefined) return { kind: "ok", ids: [] };
      prefix.push(stepFrom(inherited.templateId, text, first));
    }

    const text = templateText(templateId);
    if (text === undefined)
      return { kind: "error", message: "Missing template" };
    const rendered = await renderStep(text, templateId, prefix);
    if (rendered.kind === "error") return rendered;
    const ids: string[] = [];
    for (const result of rendered.results) {
      // Each sibling has its own step records, so none is shared between sequences
      const child: Sequence = {
        id: newId(),
        name: crypto.randomUUID(),
        parentId,
        steps: [
          ...prefix.map((step) => ({ ...step, id: newId() })),
          stepFrom(templateId, text, result),
        ],
      };
      state.sequences.push(child);
      ids.push(child.id);
    }
    return { kind: "ok", ids };
  };

  // Extends one sequence and selects the new child. Resolves to an error message
  // if rendering stopped, otherwise undefined.
  const extendSequence = async (
    parentId: string,
    templateId: string,
  ): Promise<string | undefined> => {
    const result = await extendOne(parentId, templateId);
    if (result.kind === "error") {
      sdk.window.showToast(result.message, { variant: "error" });
      return result.message;
    }
    const last = result.ids[result.ids.length - 1];
    if (last !== undefined) state.selectedSequenceId = last;
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
          if (result.kind === "ok") {
            next.push(...result.ids);
            created += result.ids.length;
          } else {
            pruned += 1;
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

  // Switching trees clears the highlight, which belongs to the tree it was made in
  const selectTree = (id: string) => {
    if (!state.trees.some((tree) => tree.id === id)) return;
    state.selectedTreeId = id;
    state.selectedSequenceId = id;
    highlighted.value = [];
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

  // The sequences highlighted in the Tree; the Sequences tab lists them
  const highlighted = ref<string[]>([]);
  const setHighlighted = (ids: string[]) => {
    highlighted.value = ids;
  };

  const selectSequence = (id: string) => {
    state.selectedSequenceId = id;
    if (!highlighted.value.includes(id)) {
      highlighted.value = [...highlighted.value, id];
    }
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
          sdk.window.showToast(rendered.message, { variant: "error" });
          return { sequences, steps, error: rendered.message };
        }
        const [first] = rendered.results;
        if (first === undefined) {
          const message = "A value this step needs is missing";
          sdk.window.showToast(message, { variant: "error" });
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

  const ruleOf = (templateId: string) => state.rules[templateId] ?? NO_RULE;

  const setRule = (templateId: string, rule: TemplateRule) => {
    state.rules[templateId] = rule;
  };

  const findStep = (sequenceId: string, stepId: string) =>
    state.sequences
      .find((s) => s.id === sequenceId)
      ?.steps.find((s) => s.id === stepId);

  // Records which items are folded in a view, so the next start shows the same
  const setFolded = (key: FoldKey, ids: string[]) => {
    state.folds = { ...state.folds, [key]: ids };
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

  const moveTemplate = (templateId: string, collectionId: string) => {
    state.templateCollection[templateId] = collectionId;
  };

  // The editable template text: the saved override, or the default request
  const templateText = (templateId: string) => {
    const template = templatesById.value.get(templateId);
    if (template === undefined) return undefined;
    return state.texts[templateId] ?? "";
  };

  const setTemplateText = (templateId: string, text: string) => {
    state.texts[templateId] = text;
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
    templatesById,
    renderings,
    selectedSequence,
    rows,
    focusStep,
    setFocusStep,
    consumeFocusStep,
    focusTemplate,
    setFocusTemplate,
    consumeFocusTemplate,
    importTemplates,
    extendSequence,
    grow,
    deleteSequence,
    rerenderSequence,
    ruleOf,
    setRule,
    missingInputs,
    selectSequence,
    selectTree,
    createTree,
    renameTree,
    deleteTree,
    makeSubtree,
    highlighted,
    setHighlighted,
    setStepTemplate,
    setFolded,
    saveStepRequest,
    saveStepResponse,
    collectionOf,
    createCollection,
    moveTemplate,
    templateText,
    setTemplateText,
    addEmptyTemplate,
    sequenceLabel,
    sequenceMethod,
    sequencePath,
  };
};
