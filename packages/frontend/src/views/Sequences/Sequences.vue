<script setup lang="ts">
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import InputText from "primevue/inputtext";
import { computed, ref } from "vue";

import type { SequenceRow, Workspace } from "@/workspace/workspace";

const { workspace } = defineProps<{ workspace: Workspace }>();
const newName = ref("");
const selectedRow = computed(() =>
  workspace.rows.value.find(
    (row) => row.sequence.id === workspace.state.selectedSequenceId,
  ),
);

const createSequence = () => {
  const name = newName.value.trim();
  if (name === "") return;
  workspace.createSequence(name);
  newName.value = "";
};

const onSelect = (row: SequenceRow | undefined) => {
  if (row !== undefined) workspace.selectSequence(row.sequence.id);
};

const templateLabel = (templateId: string) => {
  const template = workspace.templatesById.value.get(templateId);
  return template === undefined
    ? `missing template ${templateId}`
    : `${template.method} ${template.url}`;
};
</script>

<template>
  <div class="h-full flex flex-col gap-3 p-3">
    <div class="flex items-center gap-2">
      <InputText
        v-model="newName"
        placeholder="Sequence name"
        size="small"
        @keyup.enter="createSequence"
      />
      <Button
        label="New sequence"
        icon="fas fa-plus"
        size="small"
        :disabled="newName.trim() === ''"
        @click="createSequence"
      />
    </div>

    <DataTable
      :value="workspace.rows.value"
      data-key="sequence.id"
      selection-mode="single"
      :selection="selectedRow"
      class="flex-1 min-h-0"
      @update:selection="onSelect"
    >
      <template #empty>
        <div class="py-8 text-center text-surface-400">
          <i class="fas fa-diagram-project mb-2 block text-2xl" />
          Create a sequence, then add requests to it from the Requests tab
        </div>
      </template>
      <Column header="Sequence">
        <template #body="{ data }">
          <span :style="{ paddingLeft: `${data.depth * 1.25}rem` }">
            <i
              v-if="data.depth > 0"
              class="fas fa-turn-down-right mr-1 text-surface-500"
            />
            {{ data.sequence.name }}
          </span>
        </template>
      </Column>
      <Column header="Steps" style="width: 6rem">
        <template #body="{ data }">{{
          data.sequence.templateIds.length
        }}</template>
      </Column>
    </DataTable>

    <div
      v-if="workspace.selectedSequence.value"
      class="flex flex-col gap-1 text-sm"
    >
      <div class="text-surface-300">
        {{ workspace.selectedSequence.value.name }}
      </div>
      <ol class="list-decimal pl-6 text-surface-400">
        <li
          v-for="(templateId, index) in workspace.selectedSequence.value
            .templateIds"
          :key="index"
        >
          {{ templateLabel(templateId) }}
        </li>
      </ol>
    </div>
  </div>
</template>
