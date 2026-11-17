<script setup lang="ts">
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import InputText from "primevue/inputtext";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";
import type { RequestTemplate } from "shared";
import { computed, onMounted, ref, watch } from "vue";

import { createHttpEditor, type HttpEditor } from "@/editor/httpEditor";
import { parseOpenApi } from "@/openapi/parseOpenApi";
import { useSDK } from "@/plugins/sdk";
import { payloadFields, renderRequest } from "@/requests/renderRequest";
import type { Workspace } from "@/workspace/workspace";

const { workspace } = defineProps<{ workspace: Workspace }>();
const sdk = useSDK();

const fileInput = ref<HTMLInputElement>();
const selectedTemplateId = ref<string>();
const search = ref("");
const preview = ref("");
const previewHost = ref<HTMLElement>();
let previewEditor: HttpEditor | undefined;

const selectedTemplate = computed(() => {
  const id = selectedTemplateId.value;
  return id === undefined ? undefined : workspace.templatesById.value.get(id);
});

const filteredTemplates = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (query === "") return workspace.state.templates;
  return workspace.state.templates.filter((template) =>
    [
      template.method,
      template.url,
      template.summary,
      template.operationId,
    ].some((field) => (field ?? "").toLowerCase().includes(query)),
  );
});

const payloadRows = computed(() =>
  selectedTemplate.value === undefined
    ? []
    : payloadFields(selectedTemplate.value),
);

const currentPayloads = computed(() => {
  const id = selectedTemplateId.value;
  return id === undefined ? {} : { ...workspace.state.payloads[id] };
});

const payloadValue = (key: string) => {
  const id = selectedTemplateId.value;
  return id === undefined ? "" : (workspace.state.payloads[id]?.[key] ?? "");
};

const reroll = () => {
  const template = selectedTemplate.value;
  preview.value =
    template === undefined
      ? ""
      : renderRequest(template, currentPayloads.value);
  previewEditor?.setText(preview.value);
};

const onSelectTemplate = (row: RequestTemplate | undefined) => {
  selectedTemplateId.value = row?.id;
};

const onPayloadInput = (key: string, event: Event) => {
  const id = selectedTemplateId.value;
  if (id === undefined) return;
  workspace.setPayload(id, key, (event.target as HTMLInputElement).value);
};

const addToSequence = () => {
  const sequence = workspace.selectedSequence.value;
  const template = selectedTemplate.value;
  if (sequence === undefined || template === undefined) return;
  workspace.extendSequence(sequence.id, template.id, preview.value);
};

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

watch([selectedTemplate, currentPayloads], reroll, { deep: true });

onMounted(() => {
  if (previewHost.value !== undefined) {
    previewEditor = createHttpEditor(previewHost.value, true);
    previewEditor.setText(preview.value);
  }
});
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

    <Splitter layout="horizontal" class="flex-1 min-h-0">
      <SplitterPanel :size="40" :min-size="20" class="flex flex-col min-h-0">
        <div class="flex items-center gap-2 pb-2">
          <InputText
            v-model="search"
            placeholder="Search method, URL, summary, operationId"
            size="small"
            class="flex-1"
          />
          <span class="text-xs text-surface-500 whitespace-nowrap">
            {{ filteredTemplates.length }} /
            {{ workspace.state.templates.length }}
          </span>
        </div>
        <DataTable
          :value="filteredTemplates"
          data-key="id"
          selection-mode="single"
          :selection="selectedTemplate"
          scrollable
          scroll-height="flex"
          class="flex-1 min-h-0"
          @update:selection="onSelectTemplate"
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
        </DataTable>
      </SplitterPanel>

      <SplitterPanel
        :size="60"
        class="flex flex-col min-h-0 min-w-0 overflow-hidden"
      >
        <div class="flex items-center justify-between gap-2 px-3 py-2 text-sm">
          <span class="text-surface-400 truncate">
            <template v-if="selectedTemplate"
              >{{ selectedTemplate.method }}
              {{ selectedTemplate.url }}</template
            >
          </span>
          <div class="flex gap-2">
            <Button
              label="Re-roll"
              size="small"
              severity="secondary"
              icon="fas fa-dice"
              :disabled="selectedTemplate === undefined"
              @click="reroll"
            />
            <Button
              label="Add to sequence"
              size="small"
              :disabled="
                selectedTemplate === undefined ||
                workspace.selectedSequence.value === undefined
              "
              @click="addToSequence"
            />
          </div>
        </div>

        <Splitter layout="vertical" class="flex-1 min-h-0">
          <SplitterPanel
            :size="60"
            :min-size="20"
            class="min-h-0 min-w-0 flex flex-col overflow-hidden"
          >
            <div class="px-3 py-1 text-xs text-surface-500">Preview</div>
            <div
              ref="previewHost"
              class="flex-1 min-h-0 min-w-0 overflow-hidden"
            />
          </SplitterPanel>
          <SplitterPanel
            :size="40"
            :min-size="20"
            class="min-h-0 min-w-0 flex flex-col overflow-hidden"
          >
            <div class="px-3 py-1 text-xs text-surface-500">
              Payloads: comma separates choices, {random} is a random string
            </div>
            <DataTable
              :value="payloadRows"
              data-key="key"
              scrollable
              scroll-height="flex"
              class="flex-1 min-h-0"
            >
              <template #empty>
                <div class="py-4 text-center text-surface-400">
                  Select a template to set its payloads
                </div>
              </template>
              <Column field="key" header="Field" />
              <Column header="Default">
                <template #body="{ data }">
                  <span class="font-mono text-surface-400">{{
                    data.defaultText
                  }}</span>
                </template>
              </Column>
              <Column header="Payload">
                <template #body="{ data }">
                  <InputText
                    :model-value="payloadValue(data.key)"
                    size="small"
                    class="w-full font-mono"
                    spellcheck="false"
                    @input="onPayloadInput(data.key, $event)"
                  />
                </template>
              </Column>
            </DataTable>
          </SplitterPanel>
        </Splitter>
      </SplitterPanel>
    </Splitter>
  </div>
</template>
