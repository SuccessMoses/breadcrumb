<script setup lang="ts">
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";
import type { RequestTemplate } from "shared";
import { computed, nextTick, onMounted, ref, watch } from "vue";

import { createHttpEditor, type HttpEditor } from "@/editor/httpEditor";
import { parseOpenApi } from "@/openapi/parseOpenApi";
import { useSDK } from "@/plugins/sdk";
import { compilePattern, sequenceText } from "@/query/sequenceText";
import type { Workspace } from "@/workspace/workspace";

const { workspace } = defineProps<{ workspace: Workspace }>();
const sdk = useSDK();

const METHOD_COLORS: Partial<Record<string, string>> = {
  GET: "#61affe",
  POST: "#49cc90",
  PUT: "#fca130",
  PATCH: "#50e3c2",
  DELETE: "#f93e3e",
};
const methodColor = (method: string) => METHOD_COLORS[method] ?? "#9012fe";

// The path as Swagger shows it: query parameters are left out
const displayPath = (template: RequestTemplate) =>
  template.path.replace(/\?.*$/, "");

const fileInput = ref<HTMLInputElement>();
const selectedTemplateId = ref<string>();
const search = ref("");
const newCollectionName = ref("");
const collapsed = ref<Record<string, boolean>>({});
const editorHost = ref<HTMLElement>();
let editor: HttpEditor | undefined;

const selectedTemplate = computed(() => {
  const id = selectedTemplateId.value;
  return id === undefined ? undefined : workspace.templatesById.value.get(id);
});

const matches = (template: RequestTemplate) => {
  const query = search.value.trim().toLowerCase();
  if (query === "") return true;
  return [
    template.method,
    template.url,
    template.path,
    template.summary,
    template.operationId,
  ].some((field) => (field ?? "").toLowerCase().includes(query));
};

const groups = computed(() =>
  workspace.state.collections.map((collection) => ({
    collection,
    templates: workspace.state.templates.filter(
      (template) =>
        workspace.collectionOf(template.id) === collection.id &&
        matches(template),
    ),
  })),
);

const shownCount = computed(() =>
  groups.value.reduce((count, group) => count + group.templates.length, 0),
);

const isCollapsed = (id: string) => collapsed.value[id] === true;
const toggleCollapsed = (id: string) => {
  collapsed.value = { ...collapsed.value, [id]: !isCollapsed(id) };
};

const addCollection = () => {
  workspace.createCollection(newCollectionName.value);
  newCollectionName.value = "";
};

const selectedCollectionId = computed(() =>
  selectedTemplate.value === undefined
    ? undefined
    : workspace.collectionOf(selectedTemplate.value.id),
);

const moveSelected = (collectionId: string) => {
  const id = selectedTemplateId.value;
  if (id !== undefined) workspace.moveTemplate(id, collectionId);
};

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

// A step opened from the Sequences view asks for the template behind it. Clear
// whatever would hide its row, select it, and scroll to it.
watch(
  () => workspace.focusTemplate.value,
  (templateId) => {
    if (templateId === undefined) return;
    if (!workspace.templatesById.value.has(templateId)) return;
    search.value = "";
    collapsed.value = {
      ...collapsed.value,
      [workspace.collectionOf(templateId)]: false,
    };
    selectedTemplateId.value = templateId;
    workspace.consumeFocusTemplate();
    void nextTick(() => {
      document
        .querySelector(`[data-template-id="${templateId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  },
  { immediate: true },
);

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
            placeholder="Search method, path, summary, operationId"
            size="small"
            class="flex-1"
          />
          <span class="text-xs text-surface-500 whitespace-nowrap">
            {{ shownCount }} / {{ workspace.state.templates.length }}
          </span>
        </div>
        <div class="flex items-center gap-2 pb-2">
          <InputText
            v-model="newCollectionName"
            placeholder="New collection"
            size="small"
            class="flex-1"
            @keydown.enter="addCollection"
          />
          <Button
            label="Add"
            size="small"
            severity="secondary"
            :disabled="newCollectionName.trim() === ''"
            @click="addCollection"
          />
        </div>

        <div class="flex-1 min-h-0 overflow-auto">
          <div
            v-if="workspace.state.templates.length === 0"
            class="py-8 text-center text-surface-400"
          >
            <i class="fas fa-file-code mb-2 block text-2xl" />
            Import an OpenAPI 3 JSON spec to create request templates
          </div>
          <template v-for="group in groups" :key="group.collection.id">
            <button
              type="button"
              class="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-surface-200 border-b border-surface-700 hover:bg-surface-800"
              @click="toggleCollapsed(group.collection.id)"
            >
              <span>{{ group.collection.name }}</span>
              <span class="flex items-center gap-2 text-xs text-surface-500">
                {{ group.templates.length }}
                <i
                  :class="
                    isCollapsed(group.collection.id)
                      ? 'fas fa-chevron-right'
                      : 'fas fa-chevron-down'
                  "
                />
              </span>
            </button>
            <template v-if="!isCollapsed(group.collection.id)">
              <button
                v-for="template in group.templates"
                :key="template.id"
                :data-template-id="template.id"
                type="button"
                class="w-full flex items-center gap-3 px-3 py-1.5 text-left text-sm hover:bg-surface-800"
                :class="
                  template.id === selectedTemplateId ? 'bg-surface-800' : ''
                "
                @click="selectedTemplateId = template.id"
              >
                <span
                  class="w-16 shrink-0 rounded py-0.5 text-center text-xs font-bold text-white"
                  :style="{ backgroundColor: methodColor(template.method) }"
                  >{{ template.method }}</span
                >
                <span class="font-mono truncate text-surface-200">{{
                  displayPath(template)
                }}</span>
                <span class="ml-auto truncate text-xs text-surface-500">{{
                  template.summary
                }}</span>
              </button>
            </template>
          </template>
        </div>
      </SplitterPanel>

      <SplitterPanel
        :size="75"
        class="flex flex-col min-h-0 min-w-0 overflow-hidden"
      >
        <div
          class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
        >
          <div class="flex items-center gap-2 min-w-0">
            <span
              v-if="selectedTemplate !== undefined"
              class="rounded px-2 py-0.5 text-xs font-bold text-white"
              :style="{ backgroundColor: methodColor(selectedTemplate.method) }"
              >{{ selectedTemplate.method }}</span
            >
            <span class="font-mono truncate text-surface-300">{{
              selectedTemplate === undefined
                ? ""
                : displayPath(selectedTemplate)
            }}</span>
          </div>
          <div class="flex items-center gap-2">
            <Select
              :model-value="selectedCollectionId"
              :options="workspace.state.collections"
              option-label="name"
              option-value="id"
              size="small"
              class="w-44"
              :disabled="selectedTemplate === undefined"
              @update:model-value="moveSelected"
            />
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
