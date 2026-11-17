import type { RequestTemplate, Sequence, SequenceStep } from "shared";
import { computed, type ComputedRef, reactive, watch } from "vue";

import { renderRequest } from "@/requests/renderRequest";
import type { FrontendSDK } from "@/types";

type Payloads = Record<string, Record<string, string>>;

type WorkspaceState = {
  templates: RequestTemplate[];
  sequences: Sequence[];
  selectedSequenceId: string | undefined;
  payloads: Payloads;
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
  createSequence: (name: string) => void;
  extendSequence: (parentId: string, templateId: string) => void;
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
  setPayload: (templateId: string, key: string, value: string) => void;
  templateAlias: (template: RequestTemplate) => string;
  setAlias: (templateId: string, alias: string) => void;
};

const EMPTY: WorkspaceState = {
  templates: [],
  sequences: [],
  selectedSequenceId: undefined,
  payloads: {},
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

const restorePayloads = (value: unknown): Payloads => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([templateId, fields]) => [
      templateId,
      typeof fields === "object" && fields !== null
        ? Object.fromEntries(
            Object.entries(fields).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            ),
          )
        : {},
    ]),
  );
};

const restoreAliases = (value: unknown): Record<string, string> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};

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
        const request =
          template === undefined ? "" : renderRequest(template, {});
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
    state.payloads = restorePayloads(
      hasKey(stored, "payloads") ? stored.payloads : undefined,
    );
    state.aliases = restoreAliases(
      hasKey(stored, "aliases") ? stored.aliases : undefined,
    );
  }

  watch(
    () => ({
      templates: state.templates,
      sequences: state.sequences,
      selectedSequenceId: state.selectedSequenceId,
      payloads: state.payloads,
      aliases: state.aliases,
    }),
    (snapshot) => sdk.storage.set(snapshot),
    { deep: true },
  );

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

  const createSequence = (name: string) => {
    const sequence: Sequence = {
      id: newId(),
      name,
      parentId: undefined,
      steps: [],
    };
    state.sequences.push(sequence);
    state.selectedSequenceId = sequence.id;
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
      request: renderRequest(template, state.payloads[templateId] ?? {}),
      response: undefined,
    };
    const childCount = state.sequences.filter(
      (s) => s.parentId === parentId,
    ).length;
    const child: Sequence = {
      id: newId(),
      name: `${parent.name}.${childCount + 1}`,
      parentId,
      steps: [...inherited, step],
    };
    state.sequences.push(child);
    state.selectedSequenceId = child.id;
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

  const setPayload = (templateId: string, key: string, value: string) => {
    state.payloads[templateId] = {
      ...state.payloads[templateId],
      [key]: value,
    };
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
    createSequence,
    extendSequence,
    selectSequence,
    saveStepRequest,
    saveStepResponse,
    setPayload,
    templateAlias,
    setAlias,
  };
};
