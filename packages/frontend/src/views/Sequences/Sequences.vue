<script setup lang="ts">
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";
import type { SequenceStep } from "shared";
import { computed, onMounted, ref, watch } from "vue";

import { createHttpEditor, type HttpEditor } from "@/editor/httpEditor";
import { useSDK } from "@/plugins/sdk";
import { renderRequest } from "@/requests/renderRequest";
import type { Workspace } from "@/workspace/workspace";

const { workspace } = defineProps<{ workspace: Workspace }>();
const sdk = useSDK();

const newName = ref("");
const selectedStepId = ref<string>();
const sending = ref(false);
const requestHost = ref<HTMLElement>();
const responseHost = ref<HTMLElement>();
let requestEditor: HttpEditor | undefined;
let responseEditor: HttpEditor | undefined;

const sequenceOptions = computed(() =>
  workspace.rows.value.map((row) => ({
    id: row.sequence.id,
    label: `${"  ".repeat(row.depth)}${row.sequence.name}`,
  })),
);

const selectedStep = computed(() =>
  workspace.selectedSequence.value?.steps.find(
    (step) => step.id === selectedStepId.value,
  ),
);

const stepTemplate = computed(() => {
  const step = selectedStep.value;
  return step === undefined
    ? undefined
    : workspace.templatesById.value.get(step.templateId);
});

const requestLine = (request: string) => request.split(/\r?\n/)[0];

const toCrlf = (text: string) => text.replace(/\r?\n/g, "\r\n");

const createSequence = () => {
  const name = newName.value.trim();
  if (name === "") return;
  workspace.createSequence(name);
  newName.value = "";
};

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

const saveStep = () => {
  if (saveSelectedEdits())
    sdk.window.showToast("Step saved", { variant: "success" });
};

const resetStep = () => {
  const template = stepTemplate.value;
  if (template === undefined) return;
  requestEditor?.setText(renderRequest(template, {}));
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

const sendStep = () => {
  const step = selectedStep.value;
  if (step !== undefined) void sendSteps([step]);
};

const sendSequence = () => {
  const steps = workspace.selectedSequence.value?.steps ?? [];
  void sendSteps(steps);
};

watch(
  () => workspace.state.selectedSequenceId,
  () => {
    selectedStepId.value = workspace.selectedSequence.value?.steps[0]?.id;
  },
  { immediate: true },
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
      <InputText
        v-model="newName"
        placeholder="New sequence name"
        size="small"
        @keyup.enter="createSequence"
      />
      <Button
        label="New"
        icon="fas fa-plus"
        size="small"
        :disabled="newName.trim() === ''"
        @click="createSequence"
      />
    </div>

    <Splitter layout="horizontal" class="flex-1 min-h-0">
      <SplitterPanel :size="25" :min-size="15" class="flex flex-col min-h-0">
        <div class="flex-1 overflow-auto">
          <div
            v-if="workspace.selectedSequence.value === undefined"
            class="p-3 text-surface-400"
          >
            Create a sequence, then add requests to it from the Requests tab.
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
            class="w-full flex gap-2 px-3 py-2 text-left text-sm hover:bg-surface-800"
            :class="
              step.id === selectedStepId
                ? 'bg-surface-800 text-surface-100'
                : 'text-surface-300'
            "
            @click="selectedStepId = step.id"
          >
            <span class="text-surface-500">{{ index + 1 }}</span>
            <span class="truncate">{{ requestLine(step.request) }}</span>
          </button>
        </div>
      </SplitterPanel>

      <SplitterPanel
        :size="75"
        class="flex flex-col min-h-0 min-w-0 overflow-hidden"
      >
        <div class="flex items-center justify-between gap-2 px-3 py-2 text-sm">
          <span class="text-surface-400">
            <template v-if="selectedStep"
              >Step
              {{
                (workspace.selectedSequence.value?.steps.indexOf(
                  selectedStep,
                ) ?? 0) + 1
              }}</template
            >
          </span>
          <div class="flex gap-2">
            <Button
              label="Reset to template"
              size="small"
              severity="secondary"
              :disabled="stepTemplate === undefined"
              @click="resetStep"
            />
            <Button
              label="Save"
              size="small"
              :disabled="selectedStep === undefined"
              @click="saveStep"
            />
            <Button
              label="Send step"
              size="small"
              severity="secondary"
              :disabled="selectedStep === undefined || sending"
              @click="sendStep"
            />
            <Button
              label="Send sequence"
              size="small"
              :disabled="
                (workspace.selectedSequence.value?.steps.length ?? 0) === 0 ||
                sending
              "
              @click="sendSequence"
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
