import type { RequestTemplate, Sequence } from "shared";
import { computed, type ComputedRef, reactive, watch } from "vue";

import type { FrontendSDK } from "@/types";

type WorkspaceState = {
  templates: RequestTemplate[];
  sequences: Sequence[];
  selectedSequenceId: string | undefined;
};

export type SequenceRow = {
  sequence: Sequence;
  depth: number;
};

const EMPTY: WorkspaceState = {
  templates: [],
  sequences: [],
  selectedSequenceId: undefined,
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

export type Workspace = {
  state: WorkspaceState;
  templatesById: ComputedRef<Map<string, RequestTemplate>>;
  selectedSequence: ComputedRef<Sequence | undefined>;
  rows: ComputedRef<SequenceRow[]>;
  importTemplates: (templates: RequestTemplate[]) => void;
  createSequence: (name: string) => void;
  extendSequence: (parentId: string, templateId: string) => void;
  selectSequence: (id: string) => void;
};

export const createWorkspace = (sdk: FrontendSDK): Workspace => {
  const stored = sdk.storage.get();
  const state = reactive<WorkspaceState>(
    isState(stored) ? { ...EMPTY, ...stored } : { ...EMPTY },
  );

  watch(
    () => ({
      templates: state.templates,
      sequences: state.sequences,
      selectedSequenceId: state.selectedSequenceId,
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
      templateIds: [],
    };
    state.sequences.push(sequence);
    state.selectedSequenceId = sequence.id;
  };

  const extendSequence = (parentId: string, templateId: string) => {
    const parent = state.sequences.find((s) => s.id === parentId);
    if (parent === undefined) return;
    const childCount = state.sequences.filter(
      (s) => s.parentId === parentId,
    ).length;
    const child: Sequence = {
      id: newId(),
      name: `${parent.name}.${childCount + 1}`,
      parentId,
      templateIds: [...parent.templateIds, templateId],
    };
    state.sequences.push(child);
    state.selectedSequenceId = child.id;
  };

  const selectSequence = (id: string) => {
    state.selectedSequenceId = id;
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
  };
};
