<script setup lang="ts">
import Button from "primevue/button";
import ContextMenu from "primevue/contextmenu";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import type { RequestTemplate, Sequence } from "shared";
import { computed, ref, watch } from "vue";

import { useSDK } from "@/plugins/sdk";
import { compilePattern, sequenceText } from "@/query/sequenceText";
import { displayPath, methodColor } from "@/requests/display";
import {
  DEFAULT_TREE_SETTINGS,
  loadTreeSettings,
  saveTreeSettings,
} from "@/settings/settings";
import type { Workspace } from "@/workspace/workspace";

const { workspace } = defineProps<{ workspace: Workspace }>();
const emit = defineEmits<{ openSequence: [id: string] }>();
const sdk = useSDK();

const menu = ref<InstanceType<typeof ContextMenu>>();
const extendTarget = ref<Sequence>();
const pattern = ref("");

// Tree settings are kept per Caido install, not per project
const settings = ref(loadTreeSettings(sdk));
const settingsVisible = ref(false);
watch(settings, (value) => saveTreeSettings(sdk, value), { deep: true });
const indent = computed(() =>
  Number.isFinite(settings.value.indent)
    ? settings.value.indent
    : DEFAULT_TREE_SETTINGS.indent,
);
const fontSize = computed(() =>
  Number.isFinite(settings.value.fontSize)
    ? settings.value.fontSize
    : DEFAULT_TREE_SETTINGS.fontSize,
);

const resetSettings = () => {
  settings.value = { ...DEFAULT_TREE_SETTINGS };
};

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

type Guide = { guides: boolean[]; last: boolean };

// How each visible row is connected to its neighbours. guides[c] says a line
// runs down lane c past this row (a later sibling of that lane's ancestor). last
// says no sibling follows, so the elbow stops at the middle. Computed from the
// visible rows, so collapsing or filtering keeps the lines joined.
const guides = computed(() => {
  const byId = new Map<string, Guide>();
  // seenBelow[d]: a row at depth d follows, before any row shallower than d
  const seenBelow: boolean[] = [];
  const rows = visibleRows.value;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row === undefined) continue;
    const { sequence, depth } = row;
    byId.set(sequence.id, {
      guides: Array.from(
        { length: Math.max(depth - 1, 0) },
        (_, lane) => seenBelow[lane + 1] === true,
      ),
      last: seenBelow[depth] !== true,
    });
    seenBelow[depth] = true;
    for (let deeper = depth + 1; deeper < seenBelow.length; deeper++) {
      seenBelow[deeper] = false;
    }
  }
  return byId;
});

const guideOf = (id: string): Guide =>
  guides.value.get(id) ?? { guides: [], last: true };

// Ancestor ids by depth: the ancestor at depth k is at index k, root first
const ancestorsById = computed(() => {
  const byId = new Map(workspace.state.sequences.map((s) => [s.id, s]));
  const chains = new Map<string, string[]>();
  const chainOf = (id: string): string[] => {
    const known = chains.get(id);
    if (known !== undefined) return known;
    const parentId = byId.get(id)?.parentId;
    const chain =
      parentId === undefined ? [] : [...chainOf(parentId), parentId];
    chains.set(id, chain);
    return chain;
  };
  for (const sequence of workspace.state.sequences) chainOf(sequence.id);
  return chains;
});

// The selected sequence and its ancestors: their elbows are traced in gold
const onPath = computed(() => {
  const id = workspace.state.selectedSequenceId;
  return new Set(
    id === undefined ? [] : [...(ancestorsById.value.get(id) ?? []), id],
  );
});

// For each traced ancestor, the row of its child on the path: its branch line is
// gold down to that row and no further
const pathEndById = computed(() => {
  const id = workspace.state.selectedSequenceId;
  const rows = new Map(
    visibleRows.value.map((row, index) => [row.sequence.id, index]),
  );
  const ends = new Map<string, number>();
  if (id === undefined) return ends;
  const chain = [...(ancestorsById.value.get(id) ?? []), id];
  for (let k = 0; k < chain.length - 1; k++) {
    const parent = chain[k];
    const child = chain[k + 1];
    const end = child === undefined ? undefined : rows.get(child);
    if (parent !== undefined && end !== undefined) ends.set(parent, end);
  }
  return ends;
});

const rowIndexOf = (id: string) =>
  visibleRows.value.findIndex((row) => row.sequence.id === id);

// A lane is the branch line of the ancestor at its depth. The top half of a row's
// lane is gold up to and including the path child's row; the bottom half only above it
const laneGold = (id: string, lane: number, half: "top" | "bottom") => {
  const ancestor = (ancestorsById.value.get(id) ?? [])[lane];
  const end =
    ancestor === undefined ? undefined : pathEndById.value.get(ancestor);
  const index = rowIndexOf(id);
  if (end === undefined || index < 0) return false;
  return half === "top" ? index <= end : index < end;
};

const laneColor = (id: string, lane: number, half: "top" | "bottom") =>
  laneGold(id, lane, half) ? "border-amber-400" : "border-surface-600";

// The trunk of a parent is gold down to its path child
const trunkColor = (id: string) => {
  const end = pathEndById.value.get(id);
  const index = rowIndexOf(id);
  return end !== undefined && index >= 0 && index < end
    ? "border-amber-400"
    : "border-surface-600";
};

// Clicking a branch line collapses or expands the sequence it hangs from
const toggleLane = (id: string, lane: number) => {
  const ancestor = (ancestorsById.value.get(id) ?? [])[lane];
  if (ancestor !== undefined) toggleCollapsed(ancestor);
};

// Batch selection. Hidden rows are dropped from it, so actions only touch what is shown.
const selected = ref<Set<string>>(new Set());
const anchorId = ref<string>();

const toggleSelected = (id: string, event: MouseEvent) => {
  const next = new Set(selected.value);
  if (event.shiftKey && anchorId.value !== undefined) {
    const ids = visibleRows.value.map((row) => row.sequence.id);
    const from = ids.indexOf(anchorId.value);
    const to = ids.indexOf(id);
    if (from !== -1 && to !== -1) {
      for (const rowId of ids.slice(
        Math.min(from, to),
        Math.max(from, to) + 1,
      )) {
        next.add(rowId);
      }
    }
  } else if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selected.value = next;
  anchorId.value = id;
};

watch(visibleRows, (rows) => {
  const visible = new Set(rows.map((row) => row.sequence.id));
  if ([...selected.value].every((id) => visible.has(id))) return;
  selected.value = new Set([...selected.value].filter((id) => visible.has(id)));
});

// Selected sequences with no selected ancestor: acting on these covers the rest
const topSelected = computed(() => {
  const byId = new Map(workspace.state.sequences.map((s) => [s.id, s]));
  return workspace.state.sequences.filter((sequence) => {
    if (!selected.value.has(sequence.id)) return false;
    let parentId = sequence.parentId;
    while (parentId !== undefined) {
      if (selected.value.has(parentId)) return false;
      parentId = byId.get(parentId)?.parentId;
    }
    return true;
  });
});

const deleteSelected = () => {
  const targets = topSelected.value.filter((s) => s.parentId !== undefined);
  if (targets.length === 0) return;
  const confirmed = window.confirm(
    `Delete ${targets.length} sequence(s) and everything under them?`,
  );
  if (!confirmed) return;
  let removed = 0;
  for (const target of targets) removed += workspace.deleteSequence(target.id);
  selected.value = new Set();
  sdk.window.showToast(`Deleted ${removed} sequence(s)`, {
    variant: "success",
  });
};

const rerenderSelected = async () => {
  const targets = topSelected.value;
  if (targets.length === 0) return;
  const confirmed = window.confirm(
    `Re-render ${targets.length} sequence(s) and everything under them from their templates? Manual step edits will be replaced.`,
  );
  if (!confirmed) return;
  let sequences = 0;
  let steps = 0;
  for (const target of targets) {
    const result = await workspace.rerenderSequence(target.id);
    // The failing render has already shown its error
    if (result.error !== undefined) return;
    sequences += result.sequences;
    steps += result.steps;
  }
  sdk.window.showToast(
    `Rendered ${steps} step(s) in ${sequences} sequence(s)`,
    {
      variant: "success",
    },
  );
};

// Extend and Grow are one dialog: with one generation it extends each source once
const MAX_GENERATIONS = 5;
const growDialog = ref(false);
const growSources = ref<Sequence[]>([]);
const growTypes = ref<string[]>([]);
const growSearch = ref("");
const growGenerations = ref(1);
const growReadyOnly = ref(false);
const growRunning = ref(false);
const growStopRequested = ref(false);

const growLabel = computed(() => {
  const only = growSources.value[0];
  return growSources.value.length === 1 && only !== undefined
    ? workspace.sequenceLabel(only)
    : `${growSources.value.length} sequences`;
});

const generations = computed(() =>
  Math.min(
    MAX_GENERATIONS,
    Math.max(1, Math.floor(growGenerations.value) || 1),
  ),
);

const growTemplates = computed(() =>
  workspace.state.templates.filter((template) =>
    growTypes.value.includes(template.id),
  ),
);

const growCandidates = computed(() => {
  const query = growSearch.value.trim().toLowerCase();
  return workspace.state.templates.filter(
    (template) =>
      query === "" ||
      [template.method, template.url, workspace.templateAlias(template)].some(
        (field) => field.toLowerCase().includes(query),
      ),
  );
});

// With a single source, the {{name}} inputs a template still lacks there
const needsFor = (template: RequestTemplate) => {
  const only = growSources.value[0];
  return growSources.value.length === 1 && only !== undefined
    ? workspace.missingInputs(template.id, only.id)
    : [];
};

// Generation one is counted exactly; later generations assume every pick is ready
const growEstimate = computed(() => {
  const picks = growTemplates.value;
  if (picks.length === 0) return 0;
  let level = growSources.value.reduce(
    (sum, source) =>
      sum +
      picks.filter(
        (template) =>
          !growReadyOnly.value ||
          workspace.missingInputs(template.id, source.id).length === 0,
      ).length,
    0,
  );
  let total = level;
  for (let generation = 1; generation < generations.value; generation++) {
    level *= picks.length;
    total += level;
  }
  return total;
});

const openGrow = (sources: Sequence[]) => {
  if (sources.length === 0) return;
  growSources.value = sources;
  growTypes.value = [];
  growSearch.value = "";
  growGenerations.value = 1;
  growDialog.value = true;
};

const toggleGrowType = (templateId: string) => {
  growTypes.value = growTypes.value.includes(templateId)
    ? growTypes.value.filter((id) => id !== templateId)
    : [...growTypes.value, templateId];
};

const runGrow = async () => {
  const sources = growSources.value;
  growRunning.value = true;
  growStopRequested.value = false;
  const result = await workspace.grow({
    sequenceIds: sources.map((source) => source.id),
    templateIds: growTemplates.value.map((template) => template.id),
    generations: generations.value,
    readyOnly: growReadyOnly.value,
    stopped: () => growStopRequested.value,
  });
  growRunning.value = false;
  // Open the sources so the new children are visible
  const sourceIds = new Set(sources.map((source) => source.id));
  collapsed.value = new Set(
    [...collapsed.value].filter((id) => !sourceIds.has(id)),
  );
  const stopped = result.stopped ? " (stopped)" : "";
  sdk.window.showToast(
    `Created ${result.created} sequence(s), ${result.pruned} failed${stopped}`,
    { variant: result.created > 0 ? "success" : "error" },
  );
  growDialog.value = false;
};

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
    command: () =>
      openGrow(extendTarget.value === undefined ? [] : [extendTarget.value]),
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

// Landing on the request a sequence is named after
const openSequence = (sequence: Sequence) => {
  workspace.selectSequence(sequence.id);
  workspace.setFocusStep(sequence.steps[sequence.steps.length - 1]?.id);
  emit("openSequence", sequence.id);
};

// The first click selects and traces the path; a click on the selected row opens it
const clickRow = (sequence: Sequence) => {
  if (sequence.id === workspace.state.selectedSequenceId) {
    openSequence(sequence);
  } else {
    workspace.selectSequence(sequence.id);
  }
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
            title="Tree settings"
            class="px-1.5 py-1 text-surface-400 hover:text-surface-100"
            @click="settingsVisible = true"
          >
            <i class="fas fa-gear" />
          </button>
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

    <div
      v-if="selected.size > 0"
      class="flex items-center gap-2 rounded border border-surface-700 px-3 py-2 text-sm"
    >
      <span class="text-surface-300">{{ selected.size }} selected</span>
      <Button
        label="Extend"
        icon="fas fa-plus"
        size="small"
        severity="secondary"
        :disabled="topSelected.length === 0"
        @click="openGrow(topSelected)"
      />
      <Button
        label="Rerender"
        icon="fas fa-rotate"
        size="small"
        severity="secondary"
        :disabled="topSelected.length === 0"
        @click="rerenderSelected"
      />
      <Button
        label="Delete"
        icon="fas fa-trash"
        size="small"
        severity="danger"
        :disabled="topSelected.every((s) => s.parentId === undefined)"
        @click="deleteSelected"
      />
      <Button label="Clear" size="small" text @click="selected = new Set()" />
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
        class="w-full flex items-center pl-3 pr-3 py-0.5 text-left"
        :style="{ fontSize: `${fontSize}px`, minHeight: '1.75rem' }"
        :class="
          onPath.has(row.sequence.id)
            ? 'text-amber-200 font-bold'
            : 'text-surface-300 hover:bg-surface-800'
        "
        @click="clickRow(row.sequence)"
        @contextmenu.prevent="openMenu($event, row.sequence)"
      >
        <!-- One lane per ancestor depth. The last lane is this row's own elbow,
             whose stub runs on through the icon column to the text. -->
        <span
          v-for="(_lane, lane) in row.depth"
          :key="lane"
          class="relative h-full shrink-0"
          :style="{ width: `${indent}rem` }"
        >
          <template
            v-if="lane < row.depth - 1 && guideOf(row.sequence.id).guides[lane]"
          >
            <span
              class="absolute top-0 h-1/2 left-1/2 border-l"
              :class="laneColor(row.sequence.id, lane, 'top')"
            />
            <span
              class="absolute top-1/2 bottom-0 left-1/2 border-l"
              :class="laneColor(row.sequence.id, lane, 'bottom')"
            />
          </template>
          <template v-if="lane === row.depth - 1">
            <span
              class="absolute top-0 left-1/2 h-1/2 border-l"
              :class="laneColor(row.sequence.id, lane, 'top')"
            />
            <span
              v-if="!guideOf(row.sequence.id).last"
              class="absolute top-1/2 bottom-0 left-1/2 border-l"
              :class="laneColor(row.sequence.id, lane, 'bottom')"
            />
            <span
              class="absolute top-1/2 left-1/2 border-t"
              :class="
                onPath.has(row.sequence.id)
                  ? 'border-amber-400'
                  : 'border-surface-600'
              "
              :style="{ width: `calc(${indent / 2}rem + 1rem)` }"
            />
          </template>
          <span
            v-if="
              !filtering &&
              (lane === row.depth - 1 || guideOf(row.sequence.id).guides[lane])
            "
            class="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 cursor-pointer"
            @click.stop="toggleLane(row.sequence.id, lane)"
          />
        </span>
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <span
            class="relative flex h-full w-4 shrink-0 items-center justify-center"
          >
            <i v-if="row.depth === 0" class="fas fa-folder text-surface-500" />
            <template v-if="!filtering && hasChildren(row.sequence.id)">
              <span
                class="absolute top-1/2 bottom-0 left-1/2 border-l"
                :class="[
                  trunkColor(row.sequence.id),
                  isCollapsed(row.sequence.id) ? 'border-dashed' : '',
                ]"
              />
              <span
                class="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 cursor-pointer"
                @click.stop="toggleCollapsed(row.sequence.id)"
              />
            </template>
          </span>
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
          <span class="truncate">{{
            workspace.sequencePath(row.sequence)
          }}</span>
          <span
            v-if="!filtering && isCollapsed(row.sequence.id)"
            class="text-xs text-surface-500 whitespace-nowrap"
          >
            ({{ descendantCounts.get(row.sequence.id) }} hidden)
          </span>
          <span class="ml-auto text-xs text-surface-500">
            {{ row.sequence.steps.length }} steps
          </span>
          <span
            role="checkbox"
            :aria-checked="selected.has(row.sequence.id)"
            title="Select for batch actions. Shift-click selects a range."
            class="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border border-surface-500 text-xs"
            :class="selected.has(row.sequence.id) ? 'bg-surface-600' : ''"
            @click.stop="toggleSelected(row.sequence.id, $event)"
          >
            <i v-if="selected.has(row.sequence.id)" class="fas fa-check" />
          </span>
        </div>
      </button>
    </div>

    <ContextMenu ref="menu" :model="menuItems" />

    <Dialog
      v-model:visible="growDialog"
      modal
      :closable="!growRunning"
      :header="`${growSources.length === 1 ? 'Extend' : 'Grow'} ${growLabel}`"
      :style="{ width: '40rem' }"
    >
      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-4 text-sm text-surface-300">
          <label class="flex items-center gap-2">
            Generations
            <input
              v-model.number="growGenerations"
              type="number"
              min="1"
              :max="MAX_GENERATIONS"
              class="w-16 rounded border border-surface-600 bg-surface-900 px-2 py-1"
            />
          </label>
          <label class="flex items-center gap-2">
            <input v-model="growReadyOnly" type="checkbox" />
            Ready only
          </label>
        </div>
        <InputText
          v-model="growSearch"
          placeholder="Search method, URL, or alias"
          size="small"
          autofocus
        />
        <div class="max-h-80 overflow-auto flex flex-col">
          <div
            v-if="growCandidates.length === 0"
            class="py-6 text-center text-surface-400"
          >
            No request templates match
          </div>
          <label
            v-for="template in growCandidates"
            :key="template.id"
            class="flex items-center gap-3 px-3 py-1.5 text-sm hover:bg-surface-800"
          >
            <input
              type="checkbox"
              :checked="growTypes.includes(template.id)"
              @change="toggleGrowType(template.id)"
            />
            <span
              class="w-16 shrink-0 rounded py-0.5 text-center text-xs font-bold text-white"
              :style="{ backgroundColor: methodColor(template.method) }"
              >{{ template.method }}</span
            >
            <span class="truncate font-mono text-surface-200">{{
              displayPath(template)
            }}</span>
            <span
              v-if="needsFor(template).length > 0"
              class="ml-auto shrink-0 text-xs text-amber-400"
              >needs {{ needsFor(template).join(", ") }}</span
            >
          </label>
        </div>
        <div
          class="flex items-center justify-between gap-2 border-t border-surface-700 pt-3 text-sm"
        >
          <span class="text-surface-400">
            Up to {{ growEstimate }} sequence(s)
          </span>
          <Button
            v-if="growRunning"
            label="Stop"
            size="small"
            severity="secondary"
            @click="growStopRequested = true"
          />
          <Button
            v-else
            label="Run"
            size="small"
            :disabled="growTypes.length === 0 || growEstimate === 0"
            @click="runGrow"
          />
        </div>
      </div>
    </Dialog>

    <Dialog
      v-model:visible="settingsVisible"
      modal
      header="Tree settings"
      :style="{ width: '24rem' }"
    >
      <div class="flex flex-col gap-4 text-sm text-surface-300">
        <label class="flex items-center justify-between gap-3">
          Indentation per level (rem)
          <input
            v-model.number="settings.indent"
            type="number"
            min="0.5"
            max="6"
            step="0.25"
            class="w-24 rounded border border-surface-600 bg-surface-900 px-2 py-1"
          />
        </label>
        <label class="flex items-center justify-between gap-3">
          Text size (px)
          <input
            v-model.number="settings.fontSize"
            type="number"
            min="10"
            max="24"
            step="1"
            class="w-24 rounded border border-surface-600 bg-surface-900 px-2 py-1"
          />
        </label>
        <div class="flex justify-end">
          <Button
            label="Reset to default"
            size="small"
            severity="secondary"
            @click="resetSettings"
          />
        </div>
      </div>
    </Dialog>
  </div>
</template>
