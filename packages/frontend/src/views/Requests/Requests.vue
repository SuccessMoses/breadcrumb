<script setup lang="ts">
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import { ref } from "vue";

import { parseOpenApi } from "@/openapi/parseOpenApi";
import { useSDK } from "@/plugins/sdk";
import type { Workspace } from "@/workspace/workspace";

const { workspace } = defineProps<{ workspace: Workspace }>();
const sdk = useSDK();
const fileInput = ref<HTMLInputElement>();

const onFileChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file === undefined) return;

  const result = parseOpenApi(await file.text());
  if (result.kind === "Error") {
    sdk.window.showToast(result.error, { variant: "error" });
    return;
  }
  workspace.importTemplates(result.value);
  sdk.window.showToast(`Imported ${result.value.length} request templates`, {
    variant: "success",
  });
};

const addToSequence = (templateId: string) => {
  const selected = workspace.selectedSequence.value;
  if (selected === undefined) return;
  workspace.extendSequence(selected.id, templateId);
};
</script>

<template>
  <div class="h-full flex flex-col gap-3 p-3">
    <div class="flex items-center gap-2">
      <Button
        label="Import OpenAPI"
        icon="fas fa-file-import"
        size="small"
        @click="fileInput?.click()"
      />
      <input
        ref="fileInput"
        type="file"
        accept=".json,application/json"
        class="hidden"
        @change="onFileChange"
      />
      <span class="text-sm text-surface-400">
        <template v-if="workspace.selectedSequence.value">
          Adding to
          <span class="text-surface-100">{{
            workspace.selectedSequence.value.name
          }}</span>
        </template>
        <template v-else
          >Select a sequence in the Sequences tab to add requests to
          it</template
        >
      </span>
    </div>

    <DataTable
      :value="workspace.state.templates"
      data-key="id"
      scrollable
      scroll-height="flex"
      class="flex-1 min-h-0"
    >
      <template #empty>
        <div class="py-8 text-center text-surface-400">
          <i class="fas fa-file-code mb-2 block text-2xl" />
          Import an OpenAPI 3 JSON spec to create request templates
        </div>
      </template>
      <Column field="method" header="Method" style="width: 6rem" />
      <Column field="url" header="URL" />
      <Column field="summary" header="Summary" />
      <Column header="" style="width: 10rem">
        <template #body="{ data }">
          <Button
            label="Add to sequence"
            size="small"
            severity="secondary"
            :disabled="!workspace.selectedSequence.value"
            @click="addToSequence(data.id)"
          />
        </template>
      </Column>
    </DataTable>
  </div>
</template>
