<script setup lang="ts">
import ContextMenu from "primevue/contextmenu";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import type { RequestTemplate, Sequence } from "shared";
import { computed, ref } from "vue";

import type { Workspace } from "@/workspace/workspace";

const { workspace } = defineProps<{ workspace: Workspace }>();

const menu = ref<InstanceType<typeof ContextMenu>>();
const extendTarget = ref<Sequence>();
const pickerVisible = ref(false);
const search = ref("");

const menuItems = [
  {
    label: "Extend",
    icon: "fas fa-plus",
    command: () => {
      pickerVisible.value = true;
      search.value = "";
    },
  },
];

const openMenu = (event: MouseEvent, sequence: Sequence) => {
  extendTarget.value = sequence;
  workspace.selectSequence(sequence.id);
  menu.value?.show(event);
};

const filteredTemplates = computed(() => {
  const query = search.value.trim().toLowerCase();
  const matches = (template: RequestTemplate) =>
    [template.method, template.url, workspace.templateAlias(template)].some(
      (field) => field.toLowerCase().includes(query),
    );
  return query === ""
    ? workspace.state.templates
    : workspace.state.templates.filter(matches);
});

const extendWith = (template: RequestTemplate) => {
  const parent = extendTarget.value;
  if (parent === undefined) return;
  workspace.extendSequence(parent.id, template.id);
  pickerVisible.value = false;
};
</script>

<template>
  <div class="h-full flex flex-col gap-3 p-3">
    <div class="flex-1 min-h-0 overflow-auto">
      <div
        v-if="workspace.rows.value.length === 0"
        class="py-8 text-center text-surface-400"
      >
        <i class="fas fa-sitemap mb-2 block text-2xl" />
        No sequences yet. Create one in the Sequences tab.
      </div>
      <button
        v-for="row in workspace.rows.value"
        :key="row.sequence.id"
        type="button"
        class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-800"
        :class="
          row.sequence.id === workspace.state.selectedSequenceId
            ? 'bg-surface-800 text-surface-100'
            : 'text-surface-300'
        "
        :style="{ paddingLeft: `${row.depth * 1.5 + 0.75}rem` }"
        @click="workspace.selectSequence(row.sequence.id)"
        @contextmenu.prevent="openMenu($event, row.sequence)"
      >
        <i
          v-if="row.depth > 0"
          class="fas fa-turn-down-right text-surface-500"
        />
        <i v-else class="fas fa-folder text-surface-500" />
        <span class="truncate">{{ row.sequence.name }}</span>
        <span class="ml-auto text-xs text-surface-500">
          {{ row.sequence.steps.length }} steps
        </span>
      </button>
    </div>

    <ContextMenu ref="menu" :model="menuItems" />

    <Dialog
      v-model:visible="pickerVisible"
      modal
      :header="`Extend ${extendTarget?.name ?? ''}`"
      :style="{ width: '40rem' }"
    >
      <div class="flex flex-col gap-2">
        <InputText
          v-model="search"
          placeholder="Search method, URL, or alias"
          size="small"
          autofocus
        />
        <div class="max-h-96 overflow-auto flex flex-col">
          <div
            v-if="filteredTemplates.length === 0"
            class="py-6 text-center text-surface-400"
          >
            No request templates match
          </div>
          <button
            v-for="template in filteredTemplates"
            :key="template.id"
            type="button"
            class="flex items-center gap-3 px-3 py-1.5 text-left text-sm hover:bg-surface-800"
            @click="extendWith(template)"
          >
            <span class="w-16 font-mono text-surface-400">{{
              template.method
            }}</span>
            <span class="truncate text-surface-100">{{
              workspace.templateAlias(template)
            }}</span>
            <span class="ml-auto truncate font-mono text-xs text-surface-500">{{
              template.url
            }}</span>
          </button>
        </div>
      </div>
    </Dialog>
  </div>
</template>
