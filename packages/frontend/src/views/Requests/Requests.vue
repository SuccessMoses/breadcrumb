<script setup lang="ts">
import Button from "primevue/button";
import ContextMenu from "primevue/contextmenu";
import InputText from "primevue/inputtext";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";
import type { RequestTemplate } from "shared";
import { computed, nextTick, onMounted, ref, watch } from "vue";

import { createHttpEditor, type HttpEditor } from "@/editor/httpEditor";
import { parseOpenApi } from "@/openapi/parseOpenApi";
import { useSDK } from "@/plugins/sdk";
import { compilePattern, sequenceText } from "@/query/sequenceText";
import { sendWhenRendered } from "@/requests/notes";
import { type Capture, NO_RULE, type TemplateRule } from "@/workspace/captures";
import type { Workspace } from "@/workspace/workspace";

const { workspace, visible } = defineProps<{
  workspace: Workspace;
  // Whether the Requests tab is shown; the list is hidden, not unmounted, otherwise
  visible: boolean;
}>();
const emit = defineEmits<{ openSequence: [sequenceId: string] }>();
const sdk = useSDK();

const renderCount = (templateId: string) =>
  workspace.renderings.value.get(templateId)?.length ?? 0;

// Double-click jumps to the newest sequence that rendered this template
const openRendering = (templateId: string) => {
  const rendering = workspace.renderings.value.get(templateId)?.at(-1);
  if (rendering === undefined) {
    sdk.window.showToast("This template has not been rendered yet", {
      variant: "info",
    });
    return;
  }
  workspace.selectSequence(rendering.sequenceId);
  workspace.setFocusStep(rendering.stepId);
  emit("openSequence", rendering.sequenceId);
};

const selectedRenderCount = computed(() =>
  selectedTemplateId.value === undefined
    ? 0
    : renderCount(selectedTemplateId.value),
);

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

const menu = ref<InstanceType<typeof ContextMenu>>();
// The requests the context menu acts on: the batch if the clicked one is in it
const menuIds = ref<string[]>([]);

// Batch of requests picked in the list, and the last request clicked (the start
// of a Shift+click range)
const picked = ref<Set<string>>(new Set());
const anchorId = ref<string>();

const moveTarget = (collectionId: string) => {
  for (const id of menuIds.value) workspace.moveTemplate(id, collectionId);
};

const menuItems = computed(() => {
  const count = menuIds.value.length;
  return [
    {
      label:
        count > 1
          ? `Move ${count} requests to collection`
          : "Move to collection",
      icon: "fas fa-folder",
      items: workspace.state.collections.map((collection) => ({
        label: collection.name,
        disabled: menuIds.value.every(
          (id) => workspace.collectionOf(id) === collection.id,
        ),
        command: () => moveTarget(collection.id),
      })),
    },
  ];
});

const openMenu = (event: MouseEvent, template: RequestTemplate) => {
  menuIds.value = picked.value.has(template.id)
    ? [...picked.value]
    : [template.id];
  menu.value?.show(event);
};

// Requests in the order the list shows them, without the folded collections
const visibleTemplates = computed(() =>
  groups.value
    .filter((group) => !isCollapsed(group.collection.id))
    .flatMap((group) => group.templates),
);

// Ctrl+click toggles a request in the batch, Shift+click picks a range from the
// last request clicked, and a plain click clears the batch and opens the request
const onRowClick = (template: RequestTemplate, event: MouseEvent) => {
  if (event.shiftKey && anchorId.value !== undefined) {
    const ids = visibleTemplates.value.map((t) => t.id);
    const from = ids.indexOf(anchorId.value);
    const to = ids.indexOf(template.id);
    if (from !== -1 && to !== -1) {
      picked.value = new Set(
        ids.slice(Math.min(from, to), Math.max(from, to) + 1),
      );
    }
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    const next = new Set(picked.value);
    if (next.has(template.id)) next.delete(template.id);
    else next.add(template.id);
    picked.value = next;
    anchorId.value = template.id;
    return;
  }
  picked.value = new Set();
  anchorId.value = template.id;
  selectedTemplateId.value = template.id;
};

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

const renderOnTop = async () => {
  const template = selectedTemplate.value;
  if (template === undefined) return;
  // Snapshot the matches first: extending adds children that must not match again
  const targetIds = renderTargets.value.map((sequence) => sequence.id);
  let rendered = 0;
  for (const id of targetIds) {
    // A failed render has already shown its error; the rest are left alone
    if ((await workspace.extendSequence(id, template.id)) !== undefined) break;
    rendered += 1;
  }
  if (rendered === targetIds.length) {
    sdk.window.showToast(`Rendered on ${rendered} sequence(s)`, {
      variant: "success",
    });
  }
};

// Captures and send-on-render belong to the selected template
const rule = computed(() => {
  const id = selectedTemplateId.value;
  return id === undefined ? NO_RULE : workspace.ruleOf(id);
});

const updateRule = (change: (current: TemplateRule) => TemplateRule) => {
  const id = selectedTemplateId.value;
  if (id === undefined) return;
  workspace.setRule(id, change(workspace.ruleOf(id)));
};

const addCapture = () =>
  updateRule((current) => ({
    ...current,
    captures: [...current.captures, { name: "", regex: "" }],
  }));

const removeCapture = (index: number) =>
  updateRule((current) => ({
    ...current,
    captures: current.captures.filter((_, i) => i !== index),
  }));

const onCaptureInput = (index: number, field: keyof Capture, event: Event) => {
  const value = (event.target as HTMLInputElement).value;
  updateRule((current) => ({
    ...current,
    captures: current.captures.map((capture, i) =>
      i === index ? { ...capture, [field]: value } : capture,
    ),
  }));
};

const captureError = computed(() => {
  for (const capture of rule.value.captures) {
    const pattern = compilePattern(capture.regex);
    if (pattern.kind === "error") {
      return `Capture "${capture.name}": ${pattern.message}`;
    }
  }
  return undefined;
});

// Set by the template's own command line, see sendWhenRendered
const sendsOnRender = computed(() => {
  const id = selectedTemplateId.value;
  return id !== undefined && sendWhenRendered(workspace.templateText(id) ?? "");
});

const renderLabel = computed(() =>
  sendsOnRender.value
    ? `Render & send (${renderTargets.value.length})`
    : `Render on top (${renderTargets.value.length})`,
);

const toLf = (text: string) => text.replace(/\r\n/g, "\n");
const toCrlf = (text: string) => text.replace(/\r?\n/g, "\r\n");

const showTemplateText = () => {
  const id = selectedTemplateId.value;
  editor?.setText(
    id === undefined ? "" : toLf(workspace.templateText(id) ?? ""),
  );
};

// Template edits are saved shortly after typing stops. A pending save is written
// before another template is shown, so no edit is lost.
let pending: { id: string; text: string } | undefined;
let saveTimer: number | undefined;

const flushTemplate = () => {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  if (pending === undefined) return;
  const { id, text } = pending;
  pending = undefined;
  if (toLf(workspace.templateText(id) ?? "") !== toLf(text)) {
    workspace.setTemplateText(id, toCrlf(text));
  }
};

const onTemplateEdit = (text: string) => {
  const id = selectedTemplateId.value;
  if (id === undefined) return;
  if (pending !== undefined && pending.id !== id) flushTemplate();
  pending = { id, text };
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushTemplate, 300);
};

const addEmptyTemplate = () => {
  selectedTemplateId.value = workspace.addEmptyTemplate();
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
  const { added, skipped } = workspace.importTemplates(result.value);
  const kept = skipped > 0 ? `, ${skipped} already present` : "";
  sdk.window.showToast(`Added ${added} request template(s)${kept}`, {
    variant: "success",
  });
};

watch(selectedTemplateId, showTemplateText);

// Brings the request in the editor into view in the list: its collection is opened
// and its row scrolled to
const revealSelected = () => {
  const id = selectedTemplateId.value;
  if (id === undefined) return;
  const collection = workspace.collectionOf(id);
  if (isCollapsed(collection)) {
    collapsed.value = { ...collapsed.value, [collection]: false };
  }
  void nextTick(() => {
    document
      .querySelector(`[data-template-id="${id}"]`)
      ?.scrollIntoView({ block: "nearest" });
  });
};

watch(selectedTemplateId, revealSelected);

// Switching to this tab brings the request in the editor into view again
watch(
  () => visible,
  (shown) => {
    if (shown) revealSelected();
  },
);

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
    revealSelected();
  },
  { immediate: true },
);

onMounted(() => {
  if (editorHost.value !== undefined) {
    editor = createHttpEditor(editorHost.value, false, false, onTemplateEdit);
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
      <Button
        icon="fas fa-plus"
        size="small"
        severity="secondary"
        aria-label="New empty request"
        @click="addEmptyTemplate"
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
      <SplitterPanel
        :size="40"
        :min-size="20"
        class="flex flex-col min-h-0 min-w-0 overflow-hidden"
      >
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
                @contextmenu.prevent="openMenu($event, template)"
                @click="onRowClick(template, $event)"
                @dblclick="openRendering(template.id)"
              >
                <span
                  class="w-16 shrink-0 rounded py-0.5 text-center text-xs font-bold text-white"
                  :style="{ backgroundColor: methodColor(template.method) }"
                  >{{ template.method }}</span
                >
                <span
                  class="font-mono truncate"
                  :class="
                    template.id === selectedTemplateId ||
                    picked.has(template.id)
                      ? 'text-amber-200 font-bold'
                      : 'text-surface-200'
                  "
                  >{{ displayPath(template) || "(empty request)" }}</span
                >
                <span class="truncate text-xs text-surface-500">{{
                  template.summary
                }}</span>
                <span
                  v-if="renderCount(template.id) > 0"
                  class="ml-auto shrink-0 rounded border border-surface-600 px-1.5 text-xs text-surface-300"
                  :title="`Rendered in ${renderCount(template.id)} step(s). Double-click to open the newest.`"
                  >Rendered ×{{ renderCount(template.id) }}</span
                >
              </button>
            </template>
          </template>
        </div>
      </SplitterPanel>

      <SplitterPanel
        :size="60"
        :min-size="40"
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
            <span
              v-if="selectedRenderCount > 0"
              class="whitespace-nowrap rounded border border-surface-600 px-1.5 text-xs text-surface-300"
              >Rendered ×{{ selectedRenderCount }}</span
            >
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
            :label="renderLabel"
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

        <div class="flex flex-col gap-2 px-3 pb-2">
          <div class="flex items-center justify-end gap-2 text-sm">
            <Button
              label="Add capture"
              icon="fas fa-plus"
              size="small"
              severity="secondary"
              :disabled="selectedTemplate === undefined"
              @click="addCapture"
            />
          </div>
          <div
            v-for="(capture, index) in rule.captures"
            :key="index"
            class="flex items-center gap-2"
          >
            <InputText
              :model-value="capture.name"
              placeholder="name"
              size="small"
              class="w-40 font-mono"
              spellcheck="false"
              @input="onCaptureInput(index, 'name', $event)"
            />
            <InputText
              :model-value="capture.regex"
              placeholder="regex: the last group of the first match is the value"
              size="small"
              class="flex-1 font-mono"
              spellcheck="false"
              @input="onCaptureInput(index, 'regex', $event)"
            />
            <Button
              icon="fas fa-trash"
              severity="secondary"
              text
              size="small"
              @click="removeCapture(index)"
            />
          </div>
          <p v-if="captureError !== undefined" class="text-sm text-red-400">
            {{ captureError }}
          </p>
        </div>

        <div class="flex items-center justify-between gap-2 px-3 py-1">
          <span class="text-xs text-surface-500">
            Template. {random} is a new random string in each sequence it is
            rendered into. &#123;&#123;name&#125;&#125; is the first value
            captured by an earlier step, &#123;&#123;name|2&#125;&#125; the
            second, and &#123;&#123;name|*&#125;&#125; makes a sequence for each
            value.
          </span>
        </div>
        <div
          ref="editorHost"
          class="flex-1 min-h-0 min-w-0 mx-3 mb-3 overflow-hidden"
        />
      </SplitterPanel>
    </Splitter>

    <ContextMenu ref="menu" :model="menuItems" />
  </div>
</template>
