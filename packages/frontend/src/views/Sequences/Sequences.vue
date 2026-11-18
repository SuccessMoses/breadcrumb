<script setup lang="ts">
import Button from "primevue/button";
import Select from "primevue/select";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";
import type { SequenceStep } from "shared";
import { computed, onMounted, ref, watch } from "vue";

import { createHttpEditor, type HttpEditor } from "@/editor/httpEditor";
import { useSDK } from "@/plugins/sdk";
import type { Workspace } from "@/workspace/workspace";

const { workspace } = defineProps<{ workspace: Workspace }>();
const emit = defineEmits<{ openTemplate: [templateId: string] }>();
const sdk = useSDK();

const selectedStepId = ref<string>();
const sending = ref(false);
const requestHost = ref<HTMLElement>();
const responseHost = ref<HTMLElement>();
let requestEditor: HttpEditor | undefined;
let responseEditor: HttpEditor | undefined;

const sequenceOptions = computed(() =>
  workspace.rows.value.map((row) => ({
    id: row.sequence.id,
    label: `${"  ".repeat(row.depth)}${workspace.sequenceLabel(row.sequence)}`,
  })),
);

const selectedStep = computed(() =>
  workspace.selectedSequence.value?.steps.find(
    (step) => step.id === selectedStepId.value,
  ),
);

const requestLine = (request: string) => request.split(/\r?\n/)[0];

const toCrlf = (text: string) => text.replace(/\r?\n/g, "\r\n");

const saveSelectedEdits = () => {
  const sequence = workspace.selectedSequence.value;
  const step = selectedStep.value;
  if (
    sequence === undefined ||
    step === undefined ||
    requestEditor === undefined
  ) {
    return false;
  }
  workspace.saveStepRequest(
    sequence.id,
    step.id,
    toCrlf(requestEditor.getText()),
  );
  return true;
};

const sendSteps = async (steps: SequenceStep[]) => {
  const sequence = workspace.selectedSequence.value;
  if (sequence === undefined || steps.length === 0) return;
  saveSelectedEdits();
  sending.value = true;
  for (const step of steps) {
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
  const { sequences, steps, error } = await workspace.rerenderSequence(
    sequence.id,
  );
  if (error === undefined) {
    sdk.window.showToast(
      `Rendered ${steps} step(s) in ${sequences} sequence(s)`,
      { variant: "success" },
    );
  }
};

// Values this step's captures produced, shown so a run can be followed
const capturedText = computed(() =>
  Object.entries(selectedStep.value?.captured ?? {})
    .map(([name, value]) => `${name} = ${value}`)
    .join("   "),
);

const sendStep = () => {
  const step = selectedStep.value;
  if (step !== undefined) void sendSteps([step]);
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
// pick that instead of the first step the watcher above chose.
watch(
  () => workspace.focusStep.value,
  (stepId) => {
    if (stepId === undefined) return;
    const steps = workspace.selectedSequence.value?.steps ?? [];
    if (!steps.some((step) => step.id === stepId)) return;
    workspace.consumeFocusStep();
    selectedStepId.value = stepId;
  },
);

watch(selectedStep, (step) => {
  requestEditor?.setText(step === undefined ? "" : step.request);
  responseEditor?.setText(step?.response ?? "");
});

watch(
  () => selectedStep.value?.response,
  (response) => {
    responseEditor?.setText(response ?? "");
  },
);

// Rerendering the tree rewrites step requests in place, keeping the same step
// object, so watch the text itself to keep the request editor in sync.
watch(
  () => selectedStep.value?.request,
  (request) => {
    requestEditor?.setText(request ?? "");
  },
);

onMounted(() => {
  if (requestHost.value !== undefined) {
    requestEditor = createHttpEditor(requestHost.value, false);
    requestEditor.setText(selectedStep.value?.request ?? "");
  }
  if (responseHost.value !== undefined) {
    responseEditor = createHttpEditor(responseHost.value, true);
    responseEditor.setText(selectedStep.value?.response ?? "");
  }
});
</script>

<template>
  <div class="h-full flex flex-col gap-3 p-3">
    <div class="flex items-center gap-2">
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
    </div>

    <Splitter layout="horizontal" class="flex-1 min-h-0">
      <SplitterPanel
        :size="25"
        :min-size="15"
        class="flex flex-col min-h-0 min-w-0 overflow-hidden"
      >
        <div class="flex-1 min-w-0 overflow-auto">
          <div
            v-if="workspace.selectedSequence.value === undefined"
            class="p-3 text-surface-400"
          >
            Extend a sequence in the Tree tab to create one.
          </div>
          <div
            v-else-if="workspace.selectedSequence.value.steps.length === 0"
            class="p-3 text-surface-400"
          >
            This sequence has no steps yet.
          </div>
          <button
            v-for="(step, index) in workspace.selectedSequence.value?.steps ??
            []"
            :key="step.id"
            type="button"
            class="w-full min-w-0 flex gap-2 px-3 py-2 text-left text-sm hover:bg-surface-800"
            :class="
              step.id === selectedStepId
                ? 'bg-surface-800 text-surface-100'
                : 'text-surface-300'
            "
            @click="selectedStepId = step.id"
            @dblclick="openTemplate(step)"
          >
            <span class="text-surface-500">{{ index + 1 }}</span>
            <span class="min-w-0 truncate" :title="requestLine(step.request)">{{
              requestLine(step.request)
            }}</span>
          </button>
        </div>
      </SplitterPanel>

      <SplitterPanel
        :size="75"
        class="flex flex-col min-h-0 min-w-0 overflow-hidden"
      >
        <div
          class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
        >
          <span class="whitespace-nowrap text-surface-400">
            <template v-if="selectedStep"
              >Step
              {{
                (workspace.selectedSequence.value?.steps.indexOf(
                  selectedStep,
                ) ?? 0) + 1
              }}</template
            >
          </span>
          <span
            v-if="capturedText !== ''"
            class="min-w-0 truncate font-mono text-xs text-surface-500"
            :title="capturedText"
            >{{ capturedText }}</span
          >
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

        <Splitter layout="vertical" class="flex-1 min-h-0">
          <SplitterPanel
            :size="50"
            :min-size="20"
            class="min-h-0 min-w-0 flex flex-col overflow-hidden"
          >
            <div class="px-3 py-1 text-xs text-surface-500">Request</div>
            <div
              v-show="selectedStep !== undefined"
              ref="requestHost"
              class="flex-1 min-h-0 min-w-0 overflow-hidden"
            />
          </SplitterPanel>
          <SplitterPanel
            :size="50"
            :min-size="20"
            class="min-h-0 min-w-0 flex flex-col overflow-hidden"
          >
            <div class="px-3 py-1 text-xs text-surface-500">
              {{
                selectedStep?.response === undefined
                  ? "Response (not sent)"
                  : "Response"
              }}
            </div>
            <div
              ref="responseHost"
              class="flex-1 min-h-0 min-w-0 overflow-hidden"
            />
          </SplitterPanel>
        </Splitter>
      </SplitterPanel>
    </Splitter>
  </div>
</template>
