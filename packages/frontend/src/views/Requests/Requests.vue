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
import { compilePattern, sequenceText } from "@/query/sequenceText";
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

const renderPattern = ref("");
const renderMatch = computed(() => {
  const text = renderPattern.value.trim();
  return text === "" ? undefined : compilePattern(text);
});
const renderTargets = computed(() => {
  const match = renderMatch.value;
  if (match === undefined || match.kind === "error") return [];
  return workspace.rows.value
    .map((row) => row.sequence)
    .filter((sequence) => match.regex.test(sequenceText(sequence)));
});

const renderOnTop = () => {
  const template = selectedTemplate.value;
  if (template === undefined) return;
  // Snapshot the matches first: extending adds children that must not match again
  const targetIds = renderTargets.value.map((sequence) => sequence.id);
  for (const id of targetIds) workspace.extendSequence(id, template.id);
  sdk.window.showToast(`Rendered on ${targetIds.length} sequence(s)`, {
    variant: "success",
  });
};

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

const aliasValue = computed(() =>
  selectedTemplate.value === undefined
    ? ""
    : workspace.templateAlias(selectedTemplate.value),
);

const onAliasInput = (event: Event) => {
  const id = selectedTemplateId.value;
  if (id === undefined) return;
  workspace.setAlias(id, (event.target as HTMLInputElement).value);
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
    </div>

    <Splitter layout="horizontal" class="flex-1 min-h-0">
      <SplitterPanel :size="25" :min-size="15" class="flex flex-col min-h-0">
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
          <Column header="Alias">
            <template #body="{ data }">{{
              workspace.templateAlias(data)
            }}</template>
          </Column>
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
            <InputText
              :model-value="aliasValue"
              :disabled="selectedTemplate === undefined"
              placeholder="Alias"
              size="small"
              class="w-56"
              @input="onAliasInput"
            />
          </div>
        </div>

        <div class="flex items-center gap-2 px-3 pb-2">
          <InputText
            v-model="renderPattern"
            placeholder="Regex: sequences to render on top of, e.g. ^$"
            size="small"
            class="flex-1 font-mono"
            spellcheck="false"
          />
          <span class="text-xs text-surface-500 whitespace-nowrap">
            {{ renderTargets.length }} match
          </span>
          <Button
            :label="`Render on top (${renderTargets.length})`"
            size="small"
            icon="fas fa-layer-group"
            :disabled="
              selectedTemplate === undefined || renderTargets.length === 0
            "
            @click="renderOnTop"
          />
        </div>
        <p
          v-if="renderMatch !== undefined && renderMatch.kind === 'error'"
          class="px-3 pb-2 text-sm text-red-400"
        >
          Regex error: {{ renderMatch.message }}
        </p>

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
