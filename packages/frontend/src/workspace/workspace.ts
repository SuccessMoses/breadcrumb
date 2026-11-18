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
  placeholderNames,
  RESPONSE_DIVIDER,
  runCaptures,
  type TemplateRule,
} from "./captures";

import { displayPath } from "@/requests/display";
import { defaultRequest, expandTemplate } from "@/requests/renderRequest";
import type { FrontendSDK } from "@/types";

type Collection = { id: string; name: string };

const DEFAULT_COLLECTION_ID = "default";

type WorkspaceState = {
  templates: RequestTemplate[];
  sequences: Sequence[];
  selectedSequenceId: string | undefined;
  texts: Record<string, string>;
  aliases: Record<string, string>;
  collections: Collection[];
  templateCollection: Record<string, string>;
  rules: Record<string, TemplateRule>;
};

// Outcome of rendering one step: its text, its response if it was sent, and
// the values its captures produced. A failure stops the sequence it is in.
type RenderResult =
  | {
      kind: "ok";
      request: string;
      response: string | undefined;
      captured: Record<string, string>;
    }
  | { kind: "error"; message: string };

type Rendering = { sequenceId: string; stepId: string };

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
  importTemplates: (templates: RequestTemplate[]) => void;
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
  saveStepRequest: (
    sequenceId: string,
    stepId: string,
    request: string,
  ) => void;
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
  resetTemplateText: (templateId: string) => void;
  templateAlias: (template: RequestTemplate) => string;
  sequenceLabel: (sequence: Sequence) => string;
  sequenceMethod: (sequence: Sequence) => string | undefined;
  sequencePath: (sequence: Sequence) => string;
};

// A fresh object per workspace: shared maps would leak edits between projects
const emptyState = (): WorkspaceState => ({
  templates: [],
  sequences: [],
  selectedSequenceId: undefined,
  texts: {},
  aliases: {},
  collections: [],
  templateCollection: {},
  rules: {},
});

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
            hasKey(rule, "sendOnRender") &&
            typeof rule.sendOnRender === "boolean"
              ? [
                  [
                    templateId,
                    {
                      sendOnRender: rule.sendOnRender,
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

const defaultAlias = (template: RequestTemplate) =>
  template.operationId ??
  template.summary ??
  `${template.method} ${template.path}`;

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
      return [{ id: value.id, name: value.name, parentId, steps: value.steps }];
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
    state.aliases = restoreStrings(
      hasKey(stored, "aliases") ? stored.aliases : undefined,
    );
    state.rules = restoreRules(
      hasKey(stored, "rules") ? stored.rules : undefined,
    );
  }

  // Every template starts in the Default collection, which always exists
  if (!state.collections.some((c) => c.id === DEFAULT_COLLECTION_ID)) {
    state.collections.unshift({ id: DEFAULT_COLLECTION_ID, name: "Default" });
  }

  watch(
    () => ({
      templates: state.templates,
      sequences: state.sequences,
      selectedSequenceId: state.selectedSequenceId,
      texts: state.texts,
      collections: state.collections,
      templateCollection: state.templateCollection,
      aliases: state.aliases,
      rules: state.rules,
    }),
    (snapshot) => {
      const current = readRoot(sdk);
      sdk.storage.set({
        projects: { ...readProjects(current), [projectId]: snapshot },
      });
    },
    { deep: true },
  );

  const ensureRoot = () => {
    const roots = state.sequences.filter((s) => s.parentId === undefined);
    const empties = roots.filter((s) => s.steps.length === 0);
    const root: Sequence = empties.find((s) => s.name === ROOT_NAME) ??
      empties[0] ?? {
        id: newId(),
        name: ROOT_NAME,
        parentId: undefined,
        steps: [],
      };
    root.name = ROOT_NAME;
    if (!state.sequences.includes(root)) state.sequences.push(root);
    for (const sequence of roots) {
      if (sequence === root) continue;
      if (sequence.steps.length === 0) {
        // Only one empty sequence may sit at the top: drop the extra one and
        // keep its children under the root.
        for (const child of state.sequences) {
          if (child.parentId === sequence.id) child.parentId = root.id;
        }
        state.sequences.splice(state.sequences.indexOf(sequence), 1);
        continue;
      }
      sequence.parentId = root.id;
    }
    const selected = state.sequences.some(
      (s) => s.id === state.selectedSequenceId,
    );
    if (!selected) state.selectedSequenceId = root.id;
  };
  ensureRoot();

  // Name each sequence after the alias of the template that created it (its
  // last step). Names are labels only; ids are what keep sequences apart.
  const relabel = () => {
    for (const sequence of state.sequences) {
      const last = sequence.steps[sequence.steps.length - 1];
      const template =
        last === undefined
          ? undefined
          : state.templates.find((t) => t.id === last.templateId);
      if (template !== undefined) {
        sequence.name = state.aliases[template.id] ?? defaultAlias(template);
      }
    }
  };
  relabel();

  const templatesById = computed(
    () => new Map(state.templates.map((t) => [t.id, t])),
  );
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

  const rows = computed<SequenceRow[]>(() => {
    const walk = (parentId: string | undefined, depth: number): SequenceRow[] =>
      state.sequences
        .filter((s) => s.parentId === parentId)
        .flatMap((sequence) => [
          { sequence, depth },
          ...walk(sequence.id, depth + 1),
        ]);
    return walk(undefined, 0);
  });

  const importTemplates = (templates: RequestTemplate[]) => {
    state.templates = templates;
  };

  // The values the steps before a step captured. Later steps win on a name.
  const valuesBefore = (steps: SequenceStep[]) =>
    steps.reduce<Record<string, string>>(
      (values, step) => ({ ...values, ...step.captured }),
      {},
    );

  // Renders a template as the next step after the given steps: fills {{name}}
  // from them, sends the request if the template says so, then runs its
  // captures over the request (and response, if sent).
  const renderStep = async (
    templateId: string,
    before: SequenceStep[],
  ): Promise<RenderResult> => {
    const text = templateText(templateId);
    if (text === undefined)
      return { kind: "error", message: "Missing template" };
    const request = fillCaptures(expandTemplate(text), valuesBefore(before));
    const rule = state.rules[templateId] ?? NO_RULE;

    let response: string | undefined;
    if (rule.sendOnRender) {
      const sent = await sdk.backend.sendRaw(request);
      if (sent.kind === "Error") return { kind: "error", message: sent.error };
      response = sent.value;
    }

    const subject =
      response === undefined ? request : request + RESPONSE_DIVIDER + response;
    const result = runCaptures(rule.captures, subject);
    if (result.kind === "error") return result;
    return { kind: "ok", request, response, captured: result.values };
  };

  const missingInputs = (templateId: string, sequenceId: string) => {
    const text = templateText(templateId);
    const sequence = state.sequences.find((s) => s.id === sequenceId);
    if (text === undefined || sequence === undefined) return [];
    const available = valuesBefore(sequence.steps);
    return placeholderNames(text).filter(
      (name) => !Object.hasOwn(available, name),
    );
  };

  // Creates one child of a sequence, without selecting it or reporting errors.
  // Rendering stops at the first failure, so later steps never go out with a
  // value that did not come from a successful step.
  const extendOne = async (
    parentId: string,
    templateId: string,
  ): Promise<
    { kind: "ok"; id: string } | { kind: "error"; message: string }
  > => {
    const parent = state.sequences.find((s) => s.id === parentId);
    const template = templatesById.value.get(templateId);
    if (parent === undefined || template === undefined) {
      return { kind: "error", message: "Missing sequence or template" };
    }

    // Copies share no objects with the parent, so a change to one never reaches the other
    const inherited: SequenceStep[] = parent.steps.map((step) => ({
      ...step,
      id: newId(),
      response: undefined,
      captured: step.captured === undefined ? undefined : { ...step.captured },
    }));
    const rendered = await renderStep(templateId, inherited);
    if (rendered.kind === "error") return rendered;
    const step: SequenceStep = {
      id: newId(),
      templateId,
      request: rendered.request,
      response: rendered.response,
      captured: rendered.captured,
    };
    const child: Sequence = {
      id: newId(),
      name: state.aliases[templateId] ?? defaultAlias(template),
      parentId,
      steps: [...inherited, step],
    };
    state.sequences.push(child);
    return { kind: "ok", id: child.id };
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
    state.selectedSequenceId = result.id;
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
            next.push(result.id);
            created += 1;
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
        if (!templatesById.value.has(step.templateId)) continue;
        const rendered = await renderStep(
          step.templateId,
          sequence.steps.slice(0, index),
        );
        if (rendered.kind === "error") {
          sdk.window.showToast(rendered.message, { variant: "error" });
          return { sequences, steps, error: rendered.message };
        }
        step.request = rendered.request;
        step.response = rendered.response;
        step.captured = rendered.captured;
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
    return state.texts[templateId] ?? defaultRequest(template);
  };

  const setTemplateText = (templateId: string, text: string) => {
    state.texts[templateId] = text;
  };

  const resetTemplateText = (templateId: string) => {
    delete state.texts[templateId];
  };

  const templateAlias = (template: RequestTemplate) =>
    state.aliases[template.id] ?? defaultAlias(template);

  // A sequence is labelled by the method and path of the template its last
  // step came from, the same as in the Requests list. The root has no steps.
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
  const sequenceLabel = (sequence: Sequence) => {
    const method = sequenceMethod(sequence);
    return method === undefined
      ? sequence.name
      : `${method} ${sequencePath(sequence)}`;
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
    saveStepRequest,
    saveStepResponse,
    collectionOf,
    createCollection,
    moveTemplate,
    templateText,
    setTemplateText,
    resetTemplateText,
    templateAlias,
    sequenceLabel,
    sequenceMethod,
    sequencePath,
  };
};
