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
  <div class="h-full flex min-h-0">
    <aside
      class="w-56 shrink-0 flex flex-col surface-800 border-r border-surface-700"
    >
      <div
        class="flex items-center justify-between px-3 h-9 text-xs uppercase tracking-wide text-surface-400"
      >
        <span>Scripts</span>
        <Button
          icon="fas fa-plus"
          size="small"
          text
          aria-label="New script"
          @click="addScript"
        />
      </div>
      <div class="flex-1 overflow-auto">
        <button
          v-for="script in workspace.state.scripts"
          :key="script.id"
          type="button"
          class="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm truncate"
          :class="
            script.id === activeId
              ? 'surface-700 text-surface-100'
              : 'text-surface-300'
          "
          @click="pickedId = script.id"
        >
          <i class="fas fa-file-code text-xs text-surface-400" />
          <span class="truncate">{{ script.name }}</span>
        </button>
        <div
          v-if="workspace.state.scripts.length === 0"
          class="px-3 py-2 text-sm text-surface-400"
        >
          No scripts yet.
        </div>
      </div>
    </aside>

    <section class="flex-1 min-w-0 flex flex-col">
      <div
        v-if="active !== undefined"
        class="flex items-center gap-2 h-9 px-2 surface-800 border-b border-surface-700"
      >
        <InputText
          :model-value="active.name"
          size="small"
          class="w-56"
          @update:model-value="renameActive"
        />
        <div class="flex-1" />
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
        class="flex-1 min-h-0 overflow-hidden"
      />
      <div
        v-if="active === undefined"
        class="flex-1 flex items-center justify-center text-sm text-surface-400"
      >
        Create a script with +.
      </div>

      <div
        class="h-56 shrink-0 overflow-auto border-t border-surface-700 surface-900 p-3 flex flex-col gap-3 text-sm"
      >
        <div class="text-surface-400">
          Scripts run on each sequence made by Extend, top to bottom.
          <span class="font-mono">var name = expression;</span> names a set of
          sequences.
          <span class="font-mono"
            >rule name="..." message="..." expression;</span
          >
          logs the message for each sequence the expression matches. The first
          match stops the run for that sequence, across all scripts.
          Expressions: `regex` matches each whole sequence (requests and full
          responses); node(id, ...) is those sequences; children(id, ...) is
          their immediate children; a var name is its set. Combine with AND and
          OR, group with parentheses. Start a regex with (?s) to let dot match
          newlines, or (?m) to let ^ and $ match each line. Expressions may span
          several lines.
        </div>

        <div v-if="check?.kind === 'error'" class="text-red-400">
          {{ check.message }}
        </div>

        <div
          v-for="row in ruleRows"
          :key="row.rule.name"
          class="flex flex-col gap-1"
        >
          <div>
            <span class="font-mono">{{ row.rule.name }}</span>
            <span class="text-surface-400">
              &middot; {{ row.matches.length }}
              {{
                row.matches.length === 1
                  ? "sequence matches"
                  : "sequences match"
              }}
              &middot; logs "{{ row.rule.message }}"
            </span>
          </div>
          <ul
            v-if="row.matches.length > 0"
            class="font-mono text-surface-300 flex flex-col gap-0.5"
          >
            <li v-for="sequence in row.matches" :key="sequence.id">
              {{ workspace.sequenceLabel(sequence) }}
            </li>
          </ul>
        </div>
      </div>
    </section>
  </div>
</template>
