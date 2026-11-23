<script setup lang="ts">
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
        v-if="active !== undefined"
        class="px-3 py-1 text-xs text-surface-400 border-b border-surface-700"
      >
        Runs in JavaScript, once per sequence, with 2 seconds at most. The
        sequence arrives as the string input. Each line printed to stdout must
        be JSON: {"name": "...", "message": "..."}.
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
    </section>
  </div>
</template>
