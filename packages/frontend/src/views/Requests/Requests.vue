<script setup lang="ts">
import { withUpload } from "@caido-community/breadcrumb-core";
import Button from "primevue/button";
import ContextMenu from "primevue/contextmenu";
import InputText from "primevue/inputtext";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";
import { encodeBase64, type RequestTemplate, UPLOAD_LIMIT_BYTES } from "shared";
import { computed, nextTick, onMounted, ref, watch } from "vue";

import { createHttpEditor, type HttpEditor } from "@/editor/httpEditor";
import { parseOpenApi } from "@/openapi/parseOpenApi";
import { useSDK } from "@/plugins/sdk";
import { DEFAULT_COLLECTION_ID, type Workspace } from "@/workspace/workspace";

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

// Where the menu opened, so its submenu can stop at the bottom of the window
const menuTop = ref(0);
// The submenu opens down from its item, or up when the click is in the lower half
// of the window, and PrimeVue does not flip it itself. Either way it is limited to
// the room on that side and scrolls, instead of running off the window.
const menuPt = computed(() => {
  const up = menuTop.value > window.innerHeight / 2;
  const room = up ? menuTop.value : window.innerHeight - menuTop.value;
  return {
    submenu: {
      style: {
        maxHeight: `${Math.max(120, room - 24)}px`,
        overflowY: "auto",
        ...(up ? { top: "auto", bottom: "0px" } : {}),
      },
    },
  };
});

const openMenu = (event: MouseEvent, template: RequestTemplate) => {
  menuIds.value = picked.value.has(template.id)
    ? [...picked.value]
    : [template.id];
  menuTop.value = event.clientY;
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
// Folded collections, remembered with the project
const collapsed = ref<Record<string, boolean>>(
  Object.fromEntries(workspace.state.folds.requests.map((id) => [id, true])),
);
watch(collapsed, (value) =>
  workspace.setFolded(
    "requests",
    Object.keys(value).filter((id) => value[id] === true),
  ),
);
const editorHost = ref<HTMLElement>();
let editor: HttpEditor | undefined;

// Attaches a file to the template as {{upload:name}}, the same as the CLI's attach
const attachName = ref("image");
const attachError = ref("");
const attachInput = ref<HTMLInputElement>();

const attachFile = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  const name = attachName.value.trim();
  attachError.value = "";
  if (file === undefined || selectedTemplateId.value === undefined) return;
  if (!/^[A-Za-z_]\w*$/.test(name)) {
    attachError.value = "Use letters, digits and _, not starting with a digit";
    return;
  }
  if (file.name.includes("|")) {
    attachError.value = "The file name cannot contain |";
    return;
  }
  if (file.size > UPLOAD_LIMIT_BYTES) {
    attachError.value = "Files are limited to 5 MB";
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Edits still waiting to be saved go into the template first
  flushTemplate();
  const id = selectedTemplateId.value;
  if (id === undefined) return;
  const text = toLf(workspace.templateText(id) ?? "");
  workspace.setTemplateText(
    id,
    toCrlf(
      withUpload(text, {
        name,
        filename: file.name,
        data: encodeBase64(bytes),
      }),
    ),
  );
  showTemplateText();
};

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

const jsonInput = ref<HTMLInputElement>();

const copyTemplatesAsJson = async () => {
  try {
    await navigator.clipboard.writeText(workspace.exportTemplatesJson());
    sdk.window.showToast("Copied requests as JSON", { variant: "success" });
  } catch {
    sdk.window.showToast("Could not copy to the clipboard", {
      variant: "error",
    });
  }
};

const onJsonFileChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file === undefined) return;

  // The request being edited is saved first, so the import does not undo it
  flushTemplate();
  const result = workspace.importTemplatesJson(await file.text());
  if (result.kind === "error") {
    sdk.window.showToast(result.message, { variant: "error" });
    return;
  }
  // An overwritten request may be the one open in the editor
  showTemplateText();
  sdk.window.showToast(
    `Created ${result.created}, updated ${result.updated} request(s)`,
    { variant: "success" },
  );
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
        label="Copy as JSON"
        icon="fas fa-copy"
        size="small"
        severity="secondary"
        @click="copyTemplatesAsJson"
      />
      <Button
        label="Import JSON"
        icon="fas fa-file-import"
        size="small"
        severity="secondary"
        @click="jsonInput?.click()"
      />
      <input
        ref="jsonInput"
        type="file"
        accept=".json,application/json"
        class="hidden"
        @change="onJsonFileChange"
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
            <div class="flex items-center border-b border-surface-700">
              <button
                type="button"
                class="min-w-0 flex-1 flex items-center justify-between px-3 py-2 text-sm font-semibold text-surface-200 hover:bg-surface-800"
                @click="toggleCollapsed(group.collection.id)"
              >
                <span class="truncate">{{ group.collection.name }}</span>
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
              <button
                v-if="group.collection.id !== DEFAULT_COLLECTION_ID"
                type="button"
                class="shrink-0 px-3 py-2 text-xs text-surface-500 hover:text-red-400 disabled:opacity-40 disabled:hover:text-surface-500"
                :disabled="!workspace.isCollectionEmpty(group.collection.id)"
                @click="workspace.deleteCollection(group.collection.id)"
              >
                <i class="fas fa-trash" />
              </button>
            </div>
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

        <div class="flex items-center justify-between gap-2 px-3 py-1">
          <span class="text-xs text-surface-500">
            Template. {random} is a new random string in each sequence it is
            rendered into. &#123;&#123;name&#125;&#125; is the last value
            captured by an earlier step, &#123;&#123;name|2&#125;&#125; the
            second, and &#123;&#123;name|*&#125;&#125; makes a sequence for each
            value. A line "# ``dict name = a, b" starts the values of name, and
            "# ``dict name from regex" takes the last group of each match in the
            response as a value.
          </span>
        </div>
        <div
          v-if="selectedTemplate !== undefined"
          class="flex flex-wrap items-center gap-2 px-3 pb-2 text-xs text-surface-500"
        >
          <span>
            Attach a file, used as &#123;&#123;upload:name&#125;&#125; (a
            multipart part) or &#123;&#123;file:name&#125;&#125; (raw bytes). Up
            to 5 MB.
          </span>
          <InputText v-model="attachName" size="small" class="w-28" />
          <Button
            label="Attach file"
            size="small"
            severity="secondary"
            icon="fas fa-paperclip"
            @click="attachInput?.click()"
          />
          <input
            ref="attachInput"
            type="file"
            class="hidden"
            @change="attachFile"
          />
          <span v-if="attachError" class="text-red-400">{{ attachError }}</span>
        </div>
        <div
          ref="editorHost"
          class="flex-1 min-h-0 min-w-0 mx-3 mb-3 overflow-hidden"
        />
      </SplitterPanel>
    </Splitter>

    <ContextMenu ref="menu" :model="menuItems" :pt="menuPt" />
  </div>
</template>
