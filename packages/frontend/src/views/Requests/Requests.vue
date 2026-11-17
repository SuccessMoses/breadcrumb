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
import type { Workspace } from "@/workspace/workspace";

const { workspace } = defineProps<{ workspace: Workspace }>();
const sdk = useSDK();

const fileInput = ref<HTMLInputElement>();
const selectedTemplateId = ref<string>();
const search = ref("");
const editorHost = ref<HTMLElement>();
let editor: HttpEditor | undefined;

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

const onSelectTemplate = (row: RequestTemplate | undefined) => {
  selectedTemplateId.value = row?.id;
};

const toLf = (text: string) => text.replace(/\r\n/g, "\n");
const toCrlf = (text: string) => text.replace(/\r?\n/g, "\r\n");

const showTemplateText = () => {
  const id = selectedTemplateId.value;
  editor?.setText(
    id === undefined ? "" : toLf(workspace.templateText(id) ?? ""),
  );
};

const saveTemplateText = () => {
  const id = selectedTemplateId.value;
  if (id === undefined || editor === undefined) return;
  workspace.setTemplateText(id, toCrlf(editor.getText()));
  sdk.window.showToast("Template saved", { variant: "success" });
};

const resetTemplateText = () => {
  const id = selectedTemplateId.value;
  if (id === undefined) return;
  workspace.resetTemplateText(id);
  showTemplateText();
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

watch(selectedTemplateId, showTemplateText);

onMounted(() => {
  if (editorHost.value !== undefined) {
    editor = createHttpEditor(editorHost.value, false);
    showTemplateText();
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
        :size="75"
        class="flex flex-col min-h-0 min-w-0 overflow-hidden"
      >
        <div class="flex items-center justify-between gap-2 px-3 py-2 text-sm">
          <span class="text-surface-400 truncate">
            <template v-if="selectedTemplate"
              >{{ selectedTemplate.method }}
              {{ selectedTemplate.url }}</template
            >
          </span>
          <InputText
            :model-value="aliasValue"
            :disabled="selectedTemplate === undefined"
            placeholder="Alias"
            size="small"
            class="w-56"
            @input="onAliasInput"
          />
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

        <div class="flex items-center justify-between gap-2 px-3 py-1">
          <span class="text-xs text-surface-500">
            Template. {random} is a new random string in each sequence it is
            rendered into.
          </span>
          <div class="flex gap-2">
            <Button
              label="Reset"
              size="small"
              severity="secondary"
              :disabled="selectedTemplate === undefined"
              @click="resetTemplateText"
            />
            <Button
              label="Save"
              size="small"
              :disabled="selectedTemplate === undefined"
              @click="saveTemplateText"
            />
          </div>
        </div>
        <div
          ref="editorHost"
          class="flex-1 min-h-0 min-w-0 mx-3 mb-3 overflow-hidden"
        />
      </SplitterPanel>
    </Splitter>
  </div>
</template>
