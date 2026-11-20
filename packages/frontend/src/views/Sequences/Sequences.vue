<script setup lang="ts">
import Button from "primevue/button";
import type { Sequence, SequenceStep } from "shared";
import { computed, nextTick, ref, watch } from "vue";

import StepEditor from "./StepEditor.vue";

import { useSDK } from "@/plugins/sdk";
import { sendToReplay } from "@/requests/replay";
import type { Workspace } from "@/workspace/workspace";

const { workspace } = defineProps<{ workspace: Workspace }>();
const emit = defineEmits<{ openTemplate: [templateId: string] }>();
const sdk = useSDK();

// What a step's request editor exposes, so its edits can be read back
type EditorHandle = {
  getText: () => string;
  highlight: (text: string | undefined) => void;
};

const shownId = ref<string>();
const selectedStepId = ref<string>();
const sending = ref(false);
const requestEditors = new Map<string, EditorHandle>();
const blocks = new Map<string, HTMLElement>();

// The sequences highlighted in the Tree, in tree order
const listed = computed<Sequence[]>(() => {
  const ids = new Set(workspace.highlighted.value);
  return workspace.rows.value
    .map((row) => row.sequence)
    .filter((sequence) => ids.has(sequence.id));
});

// The sequence whose steps are shown: the chosen one, else the first listed
const shown = computed(
  () =>
    listed.value.find((sequence) => sequence.id === shownId.value) ??
    listed.value[0],
);

const steps = computed(() => shown.value?.steps ?? []);

const selectedStep = computed(() =>
  steps.value.find((step) => step.id === selectedStepId.value),
);

const requestLine = (request: string) => request.split(/\r?\n/)[0];

const toCrlf = (text: string) => text.replace(/\r?\n/g, "\r\n");

// Values a step's captures produced, shown on its header so a run can be followed
const capturedOf = (step: SequenceStep) =>
  Object.entries(step.captured ?? {})
    .map(([name, values]) => `${name} = ${values.join(", ")}`)
    .join("   ");

const responseEditors = new Map<string, EditorHandle>();
const registerResponse = (stepId: string, handle: unknown) => {
  if (handle === null || handle === undefined) {
    responseEditors.delete(stepId);
    return;
  }
  responseEditors.set(stepId, handle as EditorHandle);
};

// Marks every occurrence of selected text in the shown sequence's steps, requests
// and responses alike. Other sequences are left alone.
const highlightMatches = (text: string | undefined) => {
  const sequence = shown.value;
  if (sequence === undefined) return;
  for (const step of sequence.steps) {
    requestEditors.get(step.id)?.highlight(text);
    responseEditors.get(step.id)?.highlight(text);
  }
};

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

// Steps whose editor shows their template copy rather than the rendered request
const templateView = ref<Set<string>>(new Set());

// The text a step's editor shows: its template copy or its rendered request
const shownText = (step: SequenceStep) =>
  templateView.value.has(step.id)
    ? (step.template ?? workspace.templateText(step.templateId) ?? "")
    : step.request;

// Saves what is on screen in every step, so sending uses the edited text
const saveEdits = () => {
  const sequence = shown.value;
  if (sequence === undefined) return;
  for (const step of sequence.steps) {
    const editor = requestEditors.get(step.id);
    if (editor === undefined) continue;
    const text = toCrlf(editor.getText());
    if (templateView.value.has(step.id)) {
      workspace.setStepTemplate(sequence.id, step.id, text);
    } else {
      workspace.saveStepRequest(sequence.id, step.id, text);
    }
  }
};

// Switches a step between its rendered request and its template copy. What is on
// screen is saved first, so nothing typed is lost.
const toggleView = (step: SequenceStep) => {
  saveEdits();
  const next = new Set(templateView.value);
  if (next.has(step.id)) next.delete(step.id);
  else next.add(step.id);
  templateView.value = next;
};

const sendSteps = async (targets: SequenceStep[]) => {
  const sequence = shown.value;
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

// Same as rerendering from the Tree: the shown sequence and everything under it
const rerenderSequence = async () => {
  const sequence = shown.value;
  if (sequence === undefined) return;
  const confirmed = window.confirm(
    `Re-render "${workspace.sequenceLabel(sequence)}" and every sequence under it from its templates? Manual step edits will be replaced.`,
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

// Opens the selected step as a Replay session, so it can be edited and resent there
const replayStep = async () => {
  saveEdits();
  const step = selectedStep.value;
  if (step === undefined) return;
  const error = await sendToReplay(sdk, toCrlf(step.request));
  if (error !== undefined) {
    sdk.window.showToast(error, { variant: "error" });
  }
};

// Selects a step and brings its request and response into view
const jumpTo = (stepId: string) => {
  selectedStepId.value = stepId;
  blocks.get(stepId)?.scrollIntoView({ block: "start" });
};

// Opens a sequence in the right panel and brings one of its steps into view
const showStep = (sequence: Sequence, stepId: string) => {
  shownId.value = sequence.id;
  void nextTick(() => jumpTo(stepId));
};

// Double-click opens the template a step was rendered from, landing on it in
// the Requests view
const openTemplate = (step: SequenceStep) => {
  if (!workspace.templatesById.value.has(step.templateId)) return;
  selectedStepId.value = step.id;
  workspace.setFocusTemplate(step.templateId);
  emit("openTemplate", step.templateId);
};

// Deletes the shown sequence and everything under it; the root cannot be deleted
const deleteShown = () => {
  const sequence = shown.value;
  if (sequence === undefined || sequence.parentId === undefined) return;
  const confirmed = window.confirm(
    `Delete "${workspace.sequenceLabel(sequence)}" and every sequence under it?`,
  );
  if (!confirmed) return;
  const removed = workspace.deleteSequence(sequence.id);
  // Drop what no longer exists from the list, and show what is left
  workspace.setHighlighted(
    workspace.highlighted.value.filter((id) =>
      workspace.state.sequences.some((s) => s.id === id),
    ),
  );
  shownId.value = undefined;
  sdk.window.showToast(`Deleted ${removed} sequence(s)`, {
    variant: "success",
  });
};

// Opening a sequence from the Tree shows it
watch(
  () => workspace.state.selectedSequenceId,
  (id) => {
    if (id !== undefined) shownId.value = id;
  },
  { immediate: true },
);

// Showing another sequence starts at its first step
watch(
  () => shown.value?.id,
  () => {
    selectedStepId.value = steps.value[0]?.id;
  },
  { immediate: true },
);

// Double-clicking a sequence in the Tree asks for a specific step of it, so
// bring that step's sequence and the step into view instead of the first one.
watch(
  () => workspace.focusStep.value,
  (stepId) => {
    if (stepId === undefined) return;
    const owner = workspace.state.sequences.find((sequence) =>
      sequence.steps.some((step) => step.id === stepId),
    );
    if (owner === undefined) return;
    workspace.consumeFocusStep();
    shownId.value = owner.id;
    // The blocks are rendered by now only after this tick
    void nextTick(() => jumpTo(stepId));
  },
  // Immediate: the view is mounted when its tab opens, after the step was asked for
  { immediate: true },
);
</script>

<template>
  <div class="h-full flex flex-col gap-3 p-3">
    <div class="flex justify-end gap-2">
      <Button
        label="Delete"
        size="small"
        severity="danger"
        icon="fas fa-trash"
        :disabled="shown === undefined || shown.parentId === undefined"
        @click="deleteShown"
      />
      <Button
        label="Rerender"
        size="small"
        severity="secondary"
        icon="fas fa-rotate"
        :disabled="shown === undefined"
        @click="rerenderSequence"
      />
      <Button
        label="Send step"
        size="small"
        severity="secondary"
        :disabled="selectedStep === undefined || sending"
        @click="sendStep"
      />
      <Button
        label="Send to Replay"
        size="small"
        severity="secondary"
        icon="fas fa-arrow-up-right-from-square"
        :disabled="selectedStep === undefined"
        @click="replayStep"
      />
    </div>

    <div class="flex-1 min-h-0 flex gap-3">
      <aside
        class="w-[25.6rem] shrink-0 overflow-auto rounded border border-surface-700"
      >
        <div v-if="listed.length === 0" class="p-3 text-surface-400">
          Highlight sequences in the Tree tab to view them here.
        </div>
        <div
          v-for="sequence in listed"
          :key="sequence.id"
          class="cursor-pointer px-3 py-2"
          :class="
            sequence.id === shown?.id
              ? 'bg-surface-800 text-surface-100'
              : 'text-surface-300 hover:bg-surface-800'
          "
          @click="shownId = sequence.id"
        >
          <div class="truncate text-sm">
            {{ workspace.sequenceLabel(sequence) }}
          </div>
          <div class="text-xs text-surface-500">
            {{ sequence.steps.length }} steps
          </div>
          <div
            v-for="(step, index) in sequence.steps"
            :key="step.id"
            class="cursor-pointer truncate pl-3 pt-0.5 font-mono text-xs hover:text-surface-100"
            :class="
              step.id === selectedStepId
                ? 'text-surface-100'
                : 'text-surface-400'
            "
            @click.stop="showStep(sequence, step.id)"
          >
            {{ index + 1 }}. {{ requestLine(step.request) }}
          </div>
        </div>
      </aside>

      <div
        class="flex-1 min-h-0 min-w-0 overflow-auto flex flex-col gap-3 pr-1"
      >
        <div v-if="shown === undefined" class="p-3 text-surface-400">
          Nothing to show.
        </div>
        <div v-else-if="steps.length === 0" class="p-3 text-surface-400">
          This sequence has no steps yet.
        </div>
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
              requestLine(shownText(step))
            }}</span>
            <button
              type="button"
              class="shrink-0 rounded border border-surface-600 px-1.5 text-xs text-surface-300 hover:bg-surface-700"
              @click.stop="toggleView(step)"
            >
              {{ templateView.has(step.id) ? "Rendered" : "Template" }}
            </button>
            <span
              v-if="capturedOf(step) !== ''"
              class="ml-auto min-w-0 truncate font-mono text-xs text-surface-500"
              :title="capturedOf(step)"
              >{{ capturedOf(step) }}</span
            >
          </header>
          <StepEditor
            :ref="(element) => registerRequest(step.id, element)"
            :text="shownText(step)"
            :read-only="false"
            @select="highlightMatches"
          />
          <div
            class="border-t border-surface-700 bg-surface-900 px-3 py-1 text-xs text-surface-500"
          >
            {{
              step.response === undefined ? "Response (not sent)" : "Response"
            }}
          </div>
          <div class="max-h-96 overflow-auto">
            <StepEditor
              :ref="(element) => registerResponse(step.id, element)"
              :text="step.response ?? ''"
              :read-only="true"
              @select="highlightMatches"
            />
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
