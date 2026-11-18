<script setup lang="ts">
import Button from "primevue/button";
import Select from "primevue/select";
import type { SequenceStep } from "shared";
import { computed, nextTick, ref, watch } from "vue";

import StepEditor from "./StepEditor.vue";

import { useSDK } from "@/plugins/sdk";
import type { Workspace } from "@/workspace/workspace";

const { workspace } = defineProps<{ workspace: Workspace }>();
const emit = defineEmits<{ openTemplate: [templateId: string] }>();
const sdk = useSDK();

// What a step's request editor exposes, so its edits can be read back
type EditorHandle = { getText: () => string };

const selectedStepId = ref<string>();
const sending = ref(false);
const requestEditors = new Map<string, EditorHandle>();
const blocks = new Map<string, HTMLElement>();

const sequenceOptions = computed(() =>
  workspace.rows.value.map((row) => ({
    id: row.sequence.id,
    label: `${"  ".repeat(row.depth)}${workspace.sequenceLabel(row.sequence)}`,
  })),
);

const steps = computed(() => workspace.selectedSequence.value?.steps ?? []);

const selectedStep = computed(() =>
  steps.value.find((step) => step.id === selectedStepId.value),
);

const requestLine = (request: string) => request.split(/\r?\n/)[0];

const toCrlf = (text: string) => text.replace(/\r?\n/g, "\r\n");

// Values a step's captures produced, shown on its header so a run can be followed
const capturedOf = (step: SequenceStep) =>
  Object.entries(step.captured ?? {})
    .map(([name, value]) => `${name} = ${value}`)
    .join("   ");

const registerRequest = (stepId: string, handle: unknown) => {
  // Vue passes null when the editor leaves the page
  if (handle === null || handle === undefined) {
    requestEditors.delete(stepId);
    return;
  }
  requestEditors.set(stepId, handle as EditorHandle);
};

const registerBlock = (stepId: string, element: unknown) => {
  if (element instanceof HTMLElement) {
    blocks.set(stepId, element);
  } else {
    blocks.delete(stepId);
  }
};

// Saves what is on screen in every request, so sending uses the edited text
const saveEdits = () => {
  const sequence = workspace.selectedSequence.value;
  if (sequence === undefined) return;
  for (const step of sequence.steps) {
    const editor = requestEditors.get(step.id);
    if (editor !== undefined) {
      workspace.saveStepRequest(sequence.id, step.id, toCrlf(editor.getText()));
    }
  }
};

const sendSteps = async (targets: SequenceStep[]) => {
  const sequence = workspace.selectedSequence.value;
  if (sequence === undefined || targets.length === 0) return;
  saveEdits();
  sending.value = true;
  for (const step of targets) {
    const result = await sdk.backend.sendRaw(step.request);
    if (result.kind === "Error") {
      sdk.window.showToast(result.error, { variant: "error" });
      break;
    }
    workspace.saveStepResponse(sequence.id, step.id, result.value);
  }
  sending.value = false;
};

// Same as rerendering from the Tree: the selected sequence and everything under it
const rerenderSequence = async () => {
  const sequence = workspace.selectedSequence.value;
  if (sequence === undefined) return;
  const confirmed = window.confirm(
    `Re-render "${sequence.name}" and every sequence under it from its templates? Manual step edits will be replaced.`,
  );
  if (!confirmed) return;
  const {
    sequences,
    steps: rendered,
    error,
  } = await workspace.rerenderSequence(sequence.id);
  if (error === undefined) {
    sdk.window.showToast(
      `Rendered ${rendered} step(s) in ${sequences} sequence(s)`,
      { variant: "success" },
    );
  }
};

const sendStep = () => {
  const step = selectedStep.value;
  if (step !== undefined) void sendSteps([step]);
};

// Selects a step and brings its request and response into view
const jumpTo = (stepId: string) => {
  selectedStepId.value = stepId;
  blocks.get(stepId)?.scrollIntoView({ block: "start" });
};

// Double-click opens the template a step was rendered from, landing on it in
// the Requests view
const openTemplate = (step: SequenceStep) => {
  if (!workspace.templatesById.value.has(step.templateId)) return;
  selectedStepId.value = step.id;
  workspace.setFocusTemplate(step.templateId);
  emit("openTemplate", step.templateId);
};

watch(
  () => workspace.state.selectedSequenceId,
  () => {
    selectedStepId.value = workspace.selectedSequence.value?.steps[0]?.id;
  },
  { immediate: true },
);

// Double-clicking a sequence in the Tree asks for a specific step of it, so
// bring that step into view instead of the first one.
watch(
  () => workspace.focusStep.value,
  (stepId) => {
    if (stepId === undefined) return;
    if (!steps.value.some((step) => step.id === stepId)) return;
    workspace.consumeFocusStep();
    // The blocks are rendered by now only after this tick
    void nextTick(() => jumpTo(stepId));
  },
  // Immediate: the view is mounted when its tab opens, after the step was asked for
  { immediate: true },
);
</script>

<template>
  <div class="h-full flex flex-col gap-3 p-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <Select
        :model-value="workspace.state.selectedSequenceId"
        :options="sequenceOptions"
        option-label="label"
        option-value="id"
        placeholder="Select a sequence"
        size="small"
        class="w-72"
        @update:model-value="workspace.selectSequence"
      />
      <div class="flex gap-2">
        <Button
          label="Rerender"
          size="small"
          severity="secondary"
          icon="fas fa-rotate"
          :disabled="workspace.selectedSequence.value === undefined"
          @click="rerenderSequence"
        />
        <Button
          label="Send step"
          size="small"
          severity="secondary"
          :disabled="selectedStep === undefined || sending"
          @click="sendStep"
        />
      </div>
    </div>

    <div class="flex-1 min-h-0 flex gap-3">
      <aside
        class="w-64 shrink-0 overflow-auto rounded border border-surface-700"
      >
        <div
          v-if="workspace.selectedSequence.value === undefined"
          class="p-3 text-surface-400"
        >
          Extend a sequence in the Tree tab to create one.
        </div>
        <div v-else-if="steps.length === 0" class="p-3 text-surface-400">
          This sequence has no steps yet.
        </div>
        <button
          v-for="(step, index) in steps"
          :key="step.id"
          type="button"
          class="w-full min-w-0 flex gap-2 px-3 py-2 text-left text-sm hover:bg-surface-800"
          :class="
            step.id === selectedStepId
              ? 'bg-surface-800 text-surface-100'
              : 'text-surface-300'
          "
          @click="jumpTo(step.id)"
          @dblclick="openTemplate(step)"
        >
          <span class="text-surface-500">{{ index + 1 }}</span>
          <span class="min-w-0 truncate" :title="requestLine(step.request)">{{
            requestLine(step.request)
          }}</span>
        </button>
      </aside>

      <div
        class="flex-1 min-h-0 min-w-0 overflow-auto flex flex-col gap-3 pr-1"
      >
        <section
          v-for="(step, index) in steps"
          :key="step.id"
          :ref="(element) => registerBlock(step.id, element)"
          class="shrink-0 overflow-hidden rounded border"
          :class="
            step.id === selectedStepId
              ? 'border-surface-500'
              : 'border-surface-700'
          "
        >
          <header
            class="flex min-w-0 items-center gap-3 border-b border-surface-700 bg-surface-800 px-3 py-1.5 text-sm"
            @click="selectedStepId = step.id"
            @dblclick="openTemplate(step)"
          >
            <span class="text-surface-500">{{ index + 1 }}</span>
            <span class="min-w-0 truncate font-mono text-surface-200">{{
              requestLine(step.request)
            }}</span>
            <span
              v-if="capturedOf(step) !== ''"
              class="ml-auto min-w-0 truncate font-mono text-xs text-surface-500"
              :title="capturedOf(step)"
              >{{ capturedOf(step) }}</span
            >
          </header>
          <StepEditor
            :ref="(element) => registerRequest(step.id, element)"
            :text="step.request"
            :read-only="false"
          />
          <div
            class="border-t border-surface-700 bg-surface-900 px-3 py-1 text-xs text-surface-500"
          >
            {{
              step.response === undefined ? "Response (not sent)" : "Response"
            }}
          </div>
          <div class="max-h-96 overflow-auto">
            <StepEditor :text="step.response ?? ''" :read-only="true" />
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
