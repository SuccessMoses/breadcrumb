import {
  type CoreWorkspace,
  createCore,
  emptyState,
  isState,
  type Rendering,
  type SequenceRow,
  type WorkspaceState,
} from "@caido-community/breadcrumb-core";
import type { RequestTemplate, Sequence } from "shared";
import { computed, type ComputedRef, reactive, ref, watch } from "vue";

import type { FrontendSDK } from "@/types";

export { DEFAULT_COLLECTION_ID } from "@caido-community/breadcrumb-core";

// The workspace as the views use it: the shared operations, plus values derived
// from the state that update as it changes
export type Workspace = CoreWorkspace & {
  templatesById: ComputedRef<Map<string, RequestTemplate>>;
  // Every step rendered from a template, oldest first
  renderings: ComputedRef<Map<string, Rendering[]>>;
  selectedSequence: ComputedRef<Sequence | undefined>;
  rows: ComputedRef<SequenceRow[]>;
};

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
  const state = reactive<WorkspaceState>(emptyState());
  const focusStep = ref<string>();
  const focusTemplate = ref<string>();
  const highlighted = ref<string[]>([]);
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

  const core = createCore({
    state,
    adapter: {
      load: () => (legacy ? root : readProjects(root)[projectId]),
      save: (snapshot) => {
        // Keep the other keys (such as settings) that share the storage root
        const current = readRoot(sdk);
        const projects: Record<string, WorkspaceState> = {
          ...readProjects(current),
          [projectId]: snapshot,
        };
        sdk.storage.set({ ...current, projects });
      },
      sendRaw: (raw) => sdk.backend.sendRaw(raw),
      notify: (message, options) => sdk.window.showToast(message, options),
      schedule: (run, delayMs) => {
        const id = window.setTimeout(run, delayMs);
        return () => window.clearTimeout(id);
      },
    },
    focusStep,
    focusTemplate,
    highlighted,
    templatesById,
    sequencesById,
  });

  // Any change to saved state schedules a save, which the core writes after a pause
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
    () => core.scheduleSave(),
    { deep: true },
  );

  return {
    ...core,
    templatesById,
    renderings: computed(() => core.renderingsOf()),
    selectedSequence: computed(() => core.selectedSequenceOf()),
    rows: computed(() => core.rowsOf()),
  };
};
