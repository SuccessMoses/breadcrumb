<script setup lang="ts">
import { checkScript, sequenceTexts } from "@caido-community/breadcrumb-core";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { createScriptEditor, type ScriptEditor } from "@/editor/scriptEditor";
import type { Workspace } from "@/workspace/workspace";

const { workspace } = defineProps<{ workspace: Workspace }>();

// The script shown in the editor: the one picked, or the first when the picked
// one is gone
const pickedId = ref<string>();
const activeId = computed(() =>
  workspace.state.scripts.some((s) => s.id === pickedId.value)
    ? pickedId.value
    : workspace.state.scripts[0]?.id,
);
const active = computed(() =>
  workspace.state.scripts.find((s) => s.id === activeId.value),
);

// The result of the active script, with each rule's matching sequences
const texts = computed(() => sequenceTexts(workspace.state.sequences));
const check = computed(() =>
  active.value === undefined
    ? undefined
    : checkScript(active.value.code, workspace.state.sequences, texts.value),
);
const ruleRows = computed(() =>
  check.value?.kind !== "ok"
    ? []
    : check.value.rules.map((rule) => ({
        rule,
        matches: workspace.state.sequences.filter((s) => rule.ids.has(s.id)),
      })),
);

const host = ref<HTMLElement>();
let editor: ScriptEditor | undefined;

onMounted(() => {
  if (host.value === undefined) return;
  editor = createScriptEditor(host.value, (code) => {
    if (activeId.value !== undefined) {
      workspace.updateScript(activeId.value, { code });
    }
  });
  editor.setText(active.value?.code ?? "");
});
onBeforeUnmount(() => editor?.destroy());

// Shows another script, or the code that changed from outside the editor
watch(
  () => [activeId.value, active.value?.code],
  () => editor?.setText(active.value?.code ?? ""),
);

const addScript = () => {
  pickedId.value = workspace.createScript();
};

const renameActive = (name: string | undefined) => {
  if (activeId.value === undefined) return;
  workspace.updateScript(activeId.value, { name: name ?? "" });
};

const deleteActive = () => {
  if (activeId.value === undefined) return;
  workspace.deleteScript(activeId.value);
};
</script>

<template>
  <div class="h-full flex flex-col gap-3 p-3 overflow-auto">
    <div
      class="flex flex-col gap-2 p-3 rounded surface-800 text-sm text-surface-400"
    >
      <div>
        Scripts run on each sequence made by Extend, top to bottom.
        <span class="font-mono">var name = expression;</span> names a set of
        sequences.
        <span class="font-mono">rule name="..." message="..." expression;</span>
        logs the message for each sequence the expression matches. The first
        match stops the run for that sequence, across all scripts.
      </div>
      <div>
        Expressions: `regex` matches each whole sequence (requests and full
        responses); node(id, ...) is those sequences; children(id, ...) is their
        immediate children; a var name is its set. Combine with AND and OR,
        group with parentheses. Start a regex with (?s) to let dot match
        newlines, or (?m) to let ^ and $ match each line. Expressions may span
        several lines.
      </div>
    </div>

    <div class="flex gap-2 items-center flex-wrap">
      <Button
        v-for="script in workspace.state.scripts"
        :key="script.id"
        :label="script.name"
        size="small"
        :outlined="script.id !== activeId"
        @click="pickedId = script.id"
      />
      <Button
        icon="fas fa-plus"
        size="small"
        text
        aria-label="New script"
        @click="addScript"
      />
    </div>

    <div v-if="active === undefined" class="text-surface-400 text-sm px-1">
      No scripts yet. Use + to create one.
    </div>

    <div v-if="active !== undefined" class="flex gap-2 items-center">
      <InputText
        :model-value="active.name"
        size="small"
        class="w-56"
        @update:model-value="renameActive"
      />
      <Button
        icon="fas fa-trash"
        severity="danger"
        size="small"
        text
        aria-label="Delete script"
        @click="deleteActive"
      />
    </div>

    <div
      v-show="active !== undefined"
      ref="host"
      class="h-72 min-h-0 rounded overflow-hidden"
    />

    <div v-if="check?.kind === 'error'" class="text-sm text-red-400">
      {{ check.message }}
    </div>

    <div
      v-for="row in ruleRows"
      :key="row.rule.name"
      class="flex flex-col gap-1 p-3 rounded surface-800"
    >
      <div class="text-sm">
        <span class="font-mono">{{ row.rule.name }}</span>
        <span class="text-surface-400">
          &middot; {{ row.matches.length }}
          {{
            row.matches.length === 1 ? "sequence matches" : "sequences match"
          }}
          &middot; logs "{{ row.rule.message }}"
        </span>
      </div>
      <ul
        v-if="row.matches.length > 0"
        class="text-sm font-mono text-surface-300 flex flex-col gap-1"
      >
        <li v-for="sequence in row.matches" :key="sequence.id">
          {{ workspace.sequenceLabel(sequence) }}
        </li>
      </ul>
    </div>
  </div>
</template>
