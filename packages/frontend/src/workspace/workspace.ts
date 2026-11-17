import type { RequestTemplate, Sequence, SequenceStep } from "shared";
import { computed, type ComputedRef, reactive, watch } from "vue";

import { defaultRequest, expandTemplate } from "@/requests/renderRequest";
import type { FrontendSDK } from "@/types";

type WorkspaceState = {
  templates: RequestTemplate[];
  sequences: Sequence[];
  selectedSequenceId: string | undefined;
  texts: Record<string, string>;
  aliases: Record<string, string>;
};

type SequenceRow = {
  sequence: Sequence;
  depth: number;
};

export type Workspace = {
  state: WorkspaceState;
  templatesById: ComputedRef<Map<string, RequestTemplate>>;
  selectedSequence: ComputedRef<Sequence | undefined>;
  rows: ComputedRef<SequenceRow[]>;
  importTemplates: (templates: RequestTemplate[]) => void;
  extendSequence: (parentId: string, templateId: string) => void;
  deleteSequence: (id: string) => number;
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
  templateText: (templateId: string) => string | undefined;
  renderTemplate: (templateId: string) => string | undefined;
  setTemplateText: (templateId: string, text: string) => void;
  resetTemplateText: (templateId: string) => void;
  templateAlias: (template: RequestTemplate) => string;
  setAlias: (templateId: string, alias: string) => void;
};

const EMPTY: WorkspaceState = {
  templates: [],
  sequences: [],
  selectedSequenceId: undefined,
  texts: {},
  aliases: {},
};

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

export const createWorkspace = (sdk: FrontendSDK): Workspace => {
  const stored = sdk.storage.get();
  const state = reactive<WorkspaceState>({ ...EMPTY });
  if (isState(stored)) {
    state.templates = stored.templates;
    state.sequences = restoreSequences(stored.sequences, stored.templates);
    state.selectedSequenceId =
      hasKey(stored, "selectedSequenceId") &&
      typeof stored.selectedSequenceId === "string"
        ? stored.selectedSequenceId
        : undefined;
    state.texts = restoreStrings(
      hasKey(stored, "texts") ? stored.texts : undefined,
    );
    state.aliases = restoreStrings(
      hasKey(stored, "aliases") ? stored.aliases : undefined,
    );
  }

  watch(
    () => ({
      templates: state.templates,
      sequences: state.sequences,
      selectedSequenceId: state.selectedSequenceId,
      texts: state.texts,
      aliases: state.aliases,
    }),
    (snapshot) => sdk.storage.set(snapshot),
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

  const extendSequence = (parentId: string, templateId: string) => {
    const parent = state.sequences.find((s) => s.id === parentId);
    const template = templatesById.value.get(templateId);
    if (parent === undefined || template === undefined) return;

    const inherited: SequenceStep[] = parent.steps.map((step) => ({
      ...step,
      id: newId(),
      response: undefined,
    }));
    const step: SequenceStep = {
      id: newId(),
      templateId,
      request: renderTemplate(templateId) ?? "",
      response: undefined,
    };
    const child: Sequence = {
      id: newId(),
      name: state.aliases[templateId] ?? defaultAlias(template),
      parentId,
      steps: [...inherited, step],
    };
    state.sequences.push(child);
    state.selectedSequenceId = child.id;
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

  // The editable template text: the saved override, or the default request
  const templateText = (templateId: string) => {
    const template = templatesById.value.get(templateId);
    if (template === undefined) return undefined;
    return state.texts[templateId] ?? defaultRequest(template);
  };

  // The template rendered into a concrete request, with fresh {random} values
  const renderTemplate = (templateId: string) => {
    const text = templateText(templateId);
    return text === undefined ? undefined : expandTemplate(text);
  };

  const setTemplateText = (templateId: string, text: string) => {
    state.texts[templateId] = text;
  };

  const resetTemplateText = (templateId: string) => {
    delete state.texts[templateId];
  };

  const templateAlias = (template: RequestTemplate) =>
    state.aliases[template.id] ?? defaultAlias(template);

  const setAlias = (templateId: string, alias: string) => {
    state.aliases[templateId] = alias;
  };

  return {
    state,
    templatesById,
    selectedSequence,
    rows,
    importTemplates,
    extendSequence,
    deleteSequence,
    selectSequence,
    saveStepRequest,
    saveStepResponse,
    templateText,
    renderTemplate,
    setTemplateText,
    resetTemplateText,
    templateAlias,
    setAlias,
  };
};
