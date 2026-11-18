<script setup lang="ts">
import ContextMenu from "primevue/contextmenu";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import type { RequestTemplate, Sequence } from "shared";
import { computed, ref } from "vue";

import { useSDK } from "@/plugins/sdk";
import { compilePattern, sequenceText } from "@/query/sequenceText";
import { methodColor } from "@/requests/display";
import type { Workspace } from "@/workspace/workspace";

const { workspace } = defineProps<{ workspace: Workspace }>();
const emit = defineEmits<{ openSequence: [id: string] }>();
const sdk = useSDK();

const menu = ref<InstanceType<typeof ContextMenu>>();
const extendTarget = ref<Sequence>();
const pickerVisible = ref(false);
const search = ref("");
const pattern = ref("");

const compiled = computed(() => {
  const text = pattern.value.trim();
  return text === "" ? undefined : compilePattern(text);
});

// Ids of the sequences whose children are hidden.
const collapsed = ref<Set<string>>(new Set());

const childCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const sequence of workspace.state.sequences) {
    if (sequence.parentId === undefined) continue;
    counts.set(sequence.parentId, (counts.get(sequence.parentId) ?? 0) + 1);
  }
  return counts;
});

const hasChildren = (id: string) => (childCounts.value.get(id) ?? 0) > 0;

// Total number of sequences below each sequence, hidden when it is collapsed.
const descendantCounts = computed(() => {
  const childrenOf = new Map<string, string[]>();
  const roots: string[] = [];
  for (const sequence of workspace.state.sequences) {
    if (sequence.parentId === undefined) {
      roots.push(sequence.id);
      continue;
    }
    const siblings = childrenOf.get(sequence.parentId);
    if (siblings === undefined) {
      childrenOf.set(sequence.parentId, [sequence.id]);
    } else {
      siblings.push(sequence.id);
    }
  }
  const counts = new Map<string, number>();
  const count = (id: string): number => {
    const total = (childrenOf.get(id) ?? []).reduce(
      (sum, childId) => sum + 1 + count(childId),
      0,
    );
    counts.set(id, total);
    return total;
  };
  for (const id of roots) count(id);
  return counts;
});

const isCollapsed = (id: string) => collapsed.value.has(id);

const toggleCollapsed = (id: string) => {
  const next = new Set(collapsed.value);
  if (!next.delete(id)) next.add(id);
  collapsed.value = next;
};

const expandableIds = computed(() =>
  workspace.state.sequences
    .filter((sequence) => (childCounts.value.get(sequence.id) ?? 0) > 0)
    .map((sequence) => sequence.id),
);

const collapseAll = () => {
  collapsed.value = new Set(expandableIds.value);
};

const expandAll = () => {
  collapsed.value = new Set();
};

// Expands every ancestor of a sequence, so a freshly created child is visible.
const revealSequence = (id: string) => {
  const byId = new Map(workspace.state.sequences.map((s) => [s.id, s]));
  const next = new Set(collapsed.value);
  let parentId = byId.get(id)?.parentId;
  while (parentId !== undefined) {
    next.delete(parentId);
    parentId = byId.get(parentId)?.parentId;
  }
  collapsed.value = next;
};

const matchingRows = computed(() => {
  const match = compiled.value;
  if (match === undefined || match.kind === "error") {
    return workspace.rows.value;
  }
  return workspace.rows.value.filter((row) =>
    match.regex.test(sequenceText(row.sequence)),
  );
});

// A regex search shows every match, so collapsing only applies without a filter.
const filtering = computed(() => {
  const match = compiled.value;
  return match !== undefined && match.kind !== "error";
});

const visibleRows = computed(() => {
  if (filtering.value) return matchingRows.value;
  const rows: typeof matchingRows.value = [];
  let skipBelow = -1;
  for (const row of matchingRows.value) {
    if (skipBelow !== -1 && row.depth > skipBelow) continue;
    skipBelow = -1;
    rows.push(row);
    if (collapsed.value.has(row.sequence.id)) skipBelow = row.depth;
  }
  return rows;
});

const deleteTarget = () => {
  const target = extendTarget.value;
  if (target === undefined) return;
  const confirmed = window.confirm(
    `Delete "${workspace.sequenceLabel(target)}" and every sequence under it?`,
  );
  if (!confirmed) return;
  const removed = workspace.deleteSequence(target.id);
  sdk.window.showToast(`Deleted ${removed} sequence(s)`, {
    variant: "success",
  });
};

const subtreeStepCount = (id: string): number => {
  const sequence = workspace.state.sequences.find((s) => s.id === id);
  if (sequence === undefined) return 0;
  const children = workspace.state.sequences.filter((s) => s.parentId === id);
  return (
    sequence.steps.length +
    children.reduce((sum, child) => sum + subtreeStepCount(child.id), 0)
  );
};

// Hover text: the sequence's steps, one request line each
const sequenceTitle = (sequence: Sequence) =>
  sequence.steps.length === 0
    ? "No steps"
    : sequence.steps
        .map((step, index) => `${index + 1}. ${step.request.split(/\r?\n/)[0]}`)
        .join("\n");

const rerenderTarget = async () => {
  const target = extendTarget.value;
  if (target === undefined) return;
  const confirmed = window.confirm(
    `Re-render "${workspace.sequenceLabel(target)}" and every sequence under it from its templates? Manual step edits will be replaced.`,
  );
  if (!confirmed) return;
  const { sequences, steps, error } = await workspace.rerenderSequence(
    target.id,
  );
  if (error === undefined) {
    sdk.window.showToast(
      `Rendered ${steps} step(s) in ${sequences} sequence(s)`,
      { variant: "success" },
    );
  }
};

const menuItems = computed(() => [
  {
    label: "Extend",
    icon: "fas fa-plus",
    command: () => {
      pickerVisible.value = true;
      search.value = "";
    },
  },
  {
    label: "Rerender",
    icon: "fas fa-rotate",
    disabled:
      extendTarget.value === undefined ||
      subtreeStepCount(extendTarget.value.id) === 0,
    command: rerenderTarget,
  },
  {
    label: "Delete",
    icon: "fas fa-trash",
    disabled: extendTarget.value?.parentId === undefined,
    command: deleteTarget,
  },
]);

const openMenu = (event: MouseEvent, sequence: Sequence) => {
  extendTarget.value = sequence;
  workspace.selectSequence(sequence.id);
  menu.value?.show(event);
};

// Double-click opens the sequence, landing on the request it is named after
const openSequence = (sequence: Sequence) => {
  workspace.selectSequence(sequence.id);
  workspace.setFocusStep(sequence.steps[sequence.steps.length - 1]?.id);
  emit("openSequence", sequence.id);
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

const extendWith = async (template: RequestTemplate) => {
  const parent = extendTarget.value;
  if (parent === undefined) return;
  // A failed render already showed its error, and the picker stays open
  const error = await workspace.extendSequence(parent.id, template.id);
  if (error !== undefined) return;
  const childId = workspace.state.selectedSequenceId;
  if (childId !== undefined) revealSequence(childId);
  pickerVisible.value = false;
};
</script>

<template>
  <div class="h-full flex flex-col gap-3 p-3">
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <InputText
          v-model="pattern"
          placeholder="Regex over each sequence, e.g. (?s)^POST /api/v4/users/login"
          size="small"
          class="flex-1 font-mono"
          spellcheck="false"
        />
        <span class="text-xs text-surface-500 whitespace-nowrap">
          {{ visibleRows.length }} / {{ workspace.rows.value.length }}
        </span>
        <div class="flex items-center">
          <button
            type="button"
            title="Collapse all"
            class="px-1.5 py-1 text-surface-400 hover:text-surface-100 disabled:opacity-40 disabled:hover:text-surface-400"
            :disabled="filtering || expandableIds.length === 0"
            @click="collapseAll"
          >
            <i class="fas fa-angles-up" />
          </button>
          <button
            type="button"
            title="Expand all"
            class="px-1.5 py-1 text-surface-400 hover:text-surface-100 disabled:opacity-40 disabled:hover:text-surface-400"
            :disabled="filtering || collapsed.size === 0"
            @click="expandAll"
          >
            <i class="fas fa-angles-down" />
          </button>
        </div>
      </div>
      <p
        v-if="compiled !== undefined && compiled.kind === 'error'"
        class="text-sm text-red-400"
      >
        Regex error: {{ compiled.message }}
      </p>
      <details class="text-xs text-surface-400">
        <summary class="cursor-pointer">Regex usage</summary>
        <p class="py-1">
          A sequence is one text: its requests in order, each followed by its
          response head, with the requests joined by \x1e (the record
          separator). The regex is searched in that text, and matching sequences
          stay in the list. Start with (?s) so . matches newlines, and use
          [^\x1e] to stay inside one request. Example:
        </p>
        <pre class="whitespace-pre-wrap break-all font-mono py-1">
(?s)^\s*POST /api/v4/users/login[^\x1e]*(?:\x1ePOST /api/v4/users/login[^\x1e]*)*(?:\x1eGET /api/v4/users/(?:me|[^/\x1e?]+/status)\?[^\x1e]*)+</pre>
      </details>
    </div>

    <div class="flex-1 min-h-0 overflow-auto">
      <div
        v-if="workspace.rows.value.length === 0"
        class="py-8 text-center text-surface-400"
      >
        <i class="fas fa-sitemap mb-2 block text-2xl" />
        No sequences yet.
      </div>
      <div
        v-else-if="visibleRows.length === 0"
        class="py-8 text-center text-surface-400"
      >
        No sequences match the regex.
      </div>
      <button
        v-for="row in visibleRows"
        :key="row.sequence.id"
        type="button"
        :title="sequenceTitle(row.sequence)"
        class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-800"
        :class="
          row.sequence.id === workspace.state.selectedSequenceId
            ? 'bg-surface-800 text-surface-100'
            : 'text-surface-300'
        "
        :style="{ paddingLeft: `${row.depth * 1.5 + 0.75}rem` }"
        @click="workspace.selectSequence(row.sequence.id)"
        @dblclick="openSequence(row.sequence)"
        @contextmenu.prevent="openMenu($event, row.sequence)"
      >
        <span
          v-if="!filtering && hasChildren(row.sequence.id)"
          class="w-4 shrink-0 cursor-pointer text-center text-surface-500 hover:text-surface-100"
          :title="isCollapsed(row.sequence.id) ? 'Expand' : 'Collapse'"
          @click.stop="toggleCollapsed(row.sequence.id)"
          @dblclick.stop
        >
          <i
            class="fas fa-chevron-right text-xs transition-transform"
            :class="{ 'rotate-90': !isCollapsed(row.sequence.id) }"
          />
        </span>
        <span v-else class="w-4 shrink-0" />
        <i
          v-if="row.depth > 0"
          class="fas fa-turn-down-right text-surface-500"
        />
        <i v-else class="fas fa-folder text-surface-500" />
        <span
          v-if="workspace.sequenceMethod(row.sequence) !== undefined"
          class="w-16 shrink-0 rounded py-0.5 text-center text-xs font-bold text-white"
          :style="{
            backgroundColor: methodColor(
              workspace.sequenceMethod(row.sequence) ?? '',
            ),
          }"
          >{{ workspace.sequenceMethod(row.sequence) }}</span
        >
        <span class="truncate">{{ workspace.sequencePath(row.sequence) }}</span>
        <span
          v-if="!filtering && isCollapsed(row.sequence.id)"
          class="text-xs text-surface-500 whitespace-nowrap"
        >
          ({{ descendantCounts.get(row.sequence.id) }} hidden)
        </span>
        <span class="ml-auto text-xs text-surface-500">
          {{ row.sequence.steps.length }} steps
        </span>
      </button>
    </div>

    <ContextMenu ref="menu" :model="menuItems" />

    <Dialog
      v-model:visible="pickerVisible"
      modal
      :header="`Extend ${extendTarget === undefined ? '' : workspace.sequenceLabel(extendTarget)}`"
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
