<script setup lang="ts">
import {
  displayPath,
  methodColor,
  responseStatus,
  runQuery,
  sequenceTexts,
} from "@caido-community/breadcrumb-core";
import Button from "primevue/button";
import ContextMenu from "primevue/contextmenu";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import type { RequestTemplate, Sequence } from "shared";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

import { useSDK } from "@/plugins/sdk";
import {
  DEFAULT_TREE_SETTINGS,
  loadTreeSettings,
  saveTreeSettings,
} from "@/settings/settings";
import type { Workspace } from "@/workspace/workspace";

const { workspace, visible } = defineProps<{
  workspace: Workspace;
  visible: boolean;
}>();
const emit = defineEmits<{ openSequence: [id: string] }>();
const sdk = useSDK();

const menu = ref<InstanceType<typeof ContextMenu>>();
const extendTarget = ref<Sequence>();
const pattern = ref("");

// Tree settings are kept per Caido install, not per project
const settings = ref(loadTreeSettings(sdk));
const settingsVisible = ref(false);

// Trees: the dropdown picks the one shown; the dialog names a new or renamed one
const currentTreeName = computed(
  () =>
    workspace.state.trees.find(
      (tree) => tree.id === workspace.state.selectedTreeId,
    )?.name ?? "",
);
const pickTree = (id: string | undefined) => {
  if (id !== undefined) workspace.selectTree(id);
};
const treeDialogVisible = ref(false);
const treeDialogMode = ref<"create" | "rename">("create");
const treeName = ref("");
const openTreeDialog = (mode: "create" | "rename") => {
  treeDialogMode.value = mode;
  treeName.value =
    mode === "create"
      ? `Tree ${workspace.state.trees.length + 1}`
      : currentTreeName.value;
  treeDialogVisible.value = true;
};
const saveTree = () => {
  const name = treeName.value.trim();
  if (name === "") return;
  workspace.checkpoint();
  if (treeDialogMode.value === "create") {
    workspace.createTree(name);
  } else if (workspace.state.selectedTreeId !== undefined) {
    workspace.renameTree(workspace.state.selectedTreeId, name);
  }
  treeDialogVisible.value = false;
};
const deleteCurrentTree = () => {
  const id = workspace.state.selectedTreeId;
  if (id === undefined) return;
  if (workspace.state.trees.length <= 1) {
    sdk.window.showToast("The last tree cannot be deleted", {
      variant: "error",
    });
    return;
  }
  const isSubtree = workspace.state.sequences.some(
    (s) => s.id === id && s.parentId !== undefined,
  );
  const confirmed = window.confirm(
    isSubtree
      ? `Remove the subtree "${currentTreeName.value}"? Its sequences stay in the main tree.`
      : `Delete "${currentTreeName.value}" and every sequence in it?`,
  );
  if (!confirmed) return;
  workspace.checkpoint();
  const removed = workspace.deleteTree(id);
  sdk.window.showToast(`Deleted ${removed} sequence(s)`, {
    variant: "success",
  });
};
watch(
  () => workspace.state.selectedTreeId,
  () => {
    focusId.value = undefined;
  },
);
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

// The query's result, or undefined without a query. Built only when a query is
// typed, so an empty filter costs nothing.
const texts = computed(() => sequenceTexts(workspace.state.sequences));
const queryResult = computed(() =>
  pattern.value.trim() === ""
    ? undefined
    : runQuery(pattern.value, workspace.state.sequences, texts.value),
);

// Ids of the sequences whose children are hidden.
// Folded sequences, remembered with the project
// Folded sequences, remembered per tree
const foldedInTree = (): string[] =>
  workspace.state.folds.tree[workspace.state.selectedTreeId ?? ""] ?? [];
const collapsed = ref<Set<string>>(new Set(foldedInTree()));
watch(collapsed, (next) => {
  const treeId = workspace.state.selectedTreeId;
  if (treeId !== undefined) workspace.setTreeFolded(treeId, [...next]);
});
watch(
  () => workspace.state.selectedTreeId,
  () => {
    collapsed.value = new Set(foldedInTree());
  },
);

// The name of the subtree a row starts, when that is not the tree being shown
const subtreeName = (id: string) =>
  workspace.state.trees.find(
    (tree) => tree.id === id && tree.id !== workspace.state.selectedTreeId,
  )?.name;

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

// The status code of a sequence's last request, once it has been sent
const statusOf = (sequence: Sequence) =>
  responseStatus(sequence.steps[sequence.steps.length - 1]?.response);

const statusColor = (code: string) => {
  if (code.startsWith("2")) return "text-green-400";
  if (code.startsWith("3")) return "text-sky-400";
  if (code.startsWith("4")) return "text-amber-400";
  return "text-red-400";
};

// Highlights every sequence with no children, so the paths to them all light up
const selectLeaves = () => {
  selected.value = new Set(
    visibleRows.value
      .filter(
        (row) =>
          row.sequence.parentId !== undefined && !hasChildren(row.sequence.id),
      )
      .map((row) => row.sequence.id),
  );
};

const expandAll = () => {
  collapsed.value = new Set();
};

// A query shows every match, so collapsing only applies without a filter.
// A query that does not parse shows every row, with its error under the filter.
const filtering = computed(() => queryResult.value?.kind === "ok");

const matchingRows = computed(() => {
  const result = queryResult.value;
  if (result === undefined || result.kind === "error") {
    return workspace.rows.value;
  }
  return workspace.rows.value.filter((row) => result.ids.has(row.sequence.id));
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

// Everything whose branch lines light up: the selected sequence and every
// batch-selected one, each traced through its ancestors to the root
const litSources = computed(() => {
  const ids = new Set(selected.value);
  if (focusId.value !== undefined) ids.add(focusId.value);
  return [...ids];
});

const litChain = (id: string) => [...(ancestorsById.value.get(id) ?? []), id];

// Lit rows: the sources and their ancestors
const litIds = computed(() => {
  const ids = new Set<string>();
  for (const source of litSources.value) {
    for (const id of litChain(source)) ids.add(id);
  }
  return ids;
});

// For each lit parent, the row of its lit child furthest down: its branch line is
// gold down to that row and no further
const pathEndById = computed(() => {
  const rows = rowIndex.value;
  const ends = new Map<string, number>();
  for (const source of litSources.value) {
    const chain = litChain(source);
    for (let k = 0; k < chain.length - 1; k++) {
      const parent = chain[k];
      const end = rows.get(chain[k + 1] ?? "");
      if (parent === undefined || end === undefined) continue;
      ends.set(parent, Math.max(ends.get(parent) ?? -1, end));
    }
  }
  return ends;
});

const rowIndex = computed(
  () =>
    new Map(visibleRows.value.map((row, index) => [row.sequence.id, index])),
);

const rowIndexOf = (id: string) => rowIndex.value.get(id) ?? -1;

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

// The row highlighted in this view. Clicking elsewhere clears it; the workspace's
// selected sequence (what the Sequences tab shows) is left alone
const focusId = ref<string>();

// The scrolling part of the list, and how far it has been scrolled
const treeScroll = ref<HTMLElement>();
const scrolledTo = ref(0);
const viewportPx = ref(800);
const rowPx = ref(28);

const onTreeScroll = () => {
  scrolledTo.value = treeScroll.value?.scrollTop ?? 0;
};

// The viewport's height changes only when the window does
const measureViewport = () => {
  viewportPx.value = treeScroll.value?.clientHeight ?? viewportPx.value;
};

// Ctrl+Z undoes the last tree change, unless a text field has the keyboard
const undoOnCtrlZ = (event: KeyboardEvent) => {
  if (!visible || !event.ctrlKey || event.shiftKey || event.altKey) return;
  if (event.key.toLowerCase() !== "z") return;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  ) {
    return;
  }
  event.preventDefault();
  workspace.undo();
};

onMounted(() => {
  scrolledTo.value = treeScroll.value?.scrollTop ?? 0;
  measureViewport();
  window.addEventListener("resize", measureViewport);
  window.addEventListener("keydown", undoOnCtrlZ);
});

onUnmounted(() => {
  window.removeEventListener("resize", measureViewport);
  window.removeEventListener("keydown", undoOnCtrlZ);
});

// A hidden tab loses its scroll position, so the window is re-read when shown
const syncScroll = () => {
  scrolledTo.value = treeScroll.value?.scrollTop ?? 0;
  measureViewport();
  measureRow();
};
watch(
  () => visible,
  (shown) => {
    if (shown) void nextTick(syncScroll);
  },
);

// A press that moves or scrolls before release is a drag, not a click, so
// scrolling the list never clears the highlight or the batch
let press: { x: number; y: number; top: number } | undefined;
const onPress = (event: PointerEvent) => {
  press = {
    x: event.clientX,
    y: event.clientY,
    top: treeScroll.value?.scrollTop ?? 0,
  };
};
const onClickCapture = (event: MouseEvent) => {
  const start = press;
  press = undefined;
  if (start === undefined) return;
  const moved =
    Math.abs(event.clientX - start.x) > 4 ||
    Math.abs(event.clientY - start.y) > 4 ||
    (treeScroll.value?.scrollTop ?? 0) !== start.top;
  if (moved) event.stopPropagation();
};

// Only the rows near the viewport are drawn; spacers stand in for the rest, so the
// page stays small however many sequences there are
const overscan = 10;
const windowRows = computed(() => {
  const total = visibleRows.value.length;
  const first = Math.floor(scrolledTo.value / rowPx.value);
  const count = Math.ceil(viewportPx.value / rowPx.value);
  const start = Math.min(total, Math.max(0, first - overscan));
  const end = Math.min(total, first + count + overscan);
  return { start, end, total };
});
const renderedRows = computed(() =>
  visibleRows.value.slice(windowRows.value.start, windowRows.value.end),
);
const topSpacerPx = computed(() => windowRows.value.start * rowPx.value);
const bottomSpacerPx = computed(
  () => (windowRows.value.total - windowRows.value.end) * rowPx.value,
);

// Measures a row so the scroll arithmetic matches the rows. A hidden tab
// reports 0, which is ignored so the last real height is kept.
const measureRow = () => {
  const row = treeScroll.value?.querySelector<HTMLElement>("[data-row-id]");
  if (row !== null && row !== undefined && row.offsetHeight > 0) {
    rowPx.value = row.offsetHeight;
  }
};

// Measures a row once the list changes
watch(visibleRows, () => void nextTick(measureRow));

// Every sequence the highlight covers: the focused row and the batch
const highlightedIds = computed(() => {
  const ids = new Set(selected.value);
  if (focusId.value !== undefined) ids.add(focusId.value);
  return [...ids];
});

// The ancestors every highlighted sequence has in common, root first. With one
// highlighted sequence that is its own path; with several, only the shared part.
const sharedAncestors = computed(() => {
  const [first, ...rest] = highlightedIds.value;
  if (first === undefined) return [];
  let shared = ancestorsById.value.get(first) ?? [];
  for (const id of rest) {
    const chain = new Set(ancestorsById.value.get(id) ?? []);
    shared = shared.filter((ancestor) => chain.has(ancestor));
  }
  return shared;
});

// The shared ancestors scrolled past the top of the list stay pinned above it, so
// the path of the highlight is always readable, like a sticky scope in an editor
const stickyRows = computed(() => {
  const top = Math.floor(scrolledTo.value / rowPx.value);
  return sharedAncestors.value.flatMap((id) => {
    const index = rowIndexOf(id);
    const row =
      index >= 0 && index < top ? visibleRows.value[index] : undefined;
    return row === undefined
      ? []
      : [{ sequence: row.sequence, depth: row.depth }];
  });
});

// Clicking a pinned ancestor highlights it and scrolls its row to the top
const clickSticky = (
  row: { sequence: Sequence; depth: number },
  event: MouseEvent,
) => {
  clickRow(row.sequence, event);
  const index = rowIndexOf(row.sequence.id);
  if (treeScroll.value !== undefined && index >= 0) {
    treeScroll.value.scrollTop = index * rowPx.value;
  }
};

// Batch selection. Hidden rows are dropped from it, so actions only touch what is shown.
const selected = ref<Set<string>>(new Set());

// The sequence and every sequence below it
const subtreeOf = (id: string): string[] => {
  const childrenOf = new Map<string, string[]>();
  for (const sequence of workspace.state.sequences) {
    if (sequence.parentId === undefined) continue;
    const siblings = childrenOf.get(sequence.parentId);
    if (siblings === undefined) {
      childrenOf.set(sequence.parentId, [sequence.id]);
    } else {
      siblings.push(sequence.id);
    }
  }
  const ids = [id];
  for (let i = 0; i < ids.length; i++) {
    ids.push(...(childrenOf.get(ids[i] ?? "") ?? []));
  }
  return ids;
};

// Shift-click adds a sequence and all its children, or removes them if it was selected
const toggleSubtree = (id: string) => {
  const next = new Set(selected.value);
  const ids = subtreeOf(id);
  for (const rowId of ids) {
    if (selected.value.has(id)) next.delete(rowId);
    else next.add(rowId);
  }
  selected.value = next;
};

// Ctrl+Shift-click adds every sequence below one, but not the sequence itself, or
// removes them if they were all selected
const toggleDescendants = (id: string) => {
  const descendants = subtreeOf(id).slice(1);
  if (descendants.length === 0) return;
  const allSelected = descendants.every((rowId) => selected.value.has(rowId));
  const next = new Set(selected.value);
  for (const rowId of descendants) {
    if (allSelected) next.delete(rowId);
    else next.add(rowId);
  }
  selected.value = next;
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
  workspace.checkpoint();
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
  workspace.checkpoint();
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
// The picks and ready-only setting are kept in this browser, so a reload does not
// clear them. Stale template ids are dropped when the popup opens.
const EXTEND_PICKS_KEY = "breadcrumb.extendPicks";
const rememberedPicks = (): { types: string[]; readyOnly: boolean } => {
  try {
    const raw = window.localStorage.getItem(EXTEND_PICKS_KEY);
    const value = raw === null ? undefined : (JSON.parse(raw) as unknown);
    if (typeof value !== "object" || value === null) {
      return { types: [], readyOnly: false };
    }
    const { types, readyOnly } = value as Record<string, unknown>;
    return {
      types: Array.isArray(types)
        ? types.filter((id): id is string => typeof id === "string")
        : [],
      readyOnly: readyOnly === true,
    };
  } catch {
    return { types: [], readyOnly: false };
  }
};
const remembered = rememberedPicks();
const growTypes = ref<string[]>(remembered.types);
const growSearch = ref("");
const growGenerations = ref(1);
const growReadyOnly = ref(remembered.readyOnly);
watch(
  [growTypes, growReadyOnly],
  () => {
    try {
      window.localStorage.setItem(
        EXTEND_PICKS_KEY,
        JSON.stringify({
          types: growTypes.value,
          readyOnly: growReadyOnly.value,
        }),
      );
    } catch {
      // Storage can be unavailable; the picks then last until the reload
    }
  },
  { deep: true },
);
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

// The Extend list is grouped by collection, as in the Requests tab
const growGroups = computed(() =>
  workspace.state.collections
    .map((collection) => ({
      collection,
      templates: growCandidates.value.filter(
        (template) => workspace.collectionOf(template.id) === collection.id,
      ),
    }))
    .filter((group) => group.templates.length > 0),
);

// Whether all, some or none of a collection's templates are picked
const collectionState = (templates: RequestTemplate[]) => {
  const picked = templates.filter((t) => growTypes.value.includes(t.id)).length;
  if (picked === 0) return "none";
  return picked === templates.length ? "all" : "some";
};

// Collections folded shut in the Extend list; their requests stay picked
// Folded collections in the Extend popup, remembered with the project
const collapsedCollections = ref<Set<string>>(
  new Set(workspace.state.folds.extend),
);
watch(collapsedCollections, (next) => workspace.setFolded("extend", [...next]));
const toggleFolded = (id: string) => {
  const next = new Set(collapsedCollections.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsedCollections.value = next;
};

// Picks every template of a collection, or clears them if all are picked
const toggleCollection = (templates: RequestTemplate[]) => {
  const ids = templates.map((template) => template.id);
  growTypes.value =
    collectionState(templates) === "all"
      ? growTypes.value.filter((id) => !ids.includes(id))
      : [...new Set([...growTypes.value, ...ids])];
};

const growCandidates = computed(() => {
  const query = growSearch.value.trim().toLowerCase();
  return workspace.state.templates.filter(
    (template) =>
      query === "" ||
      [template.method, template.url].some((field) =>
        field.toLowerCase().includes(query),
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
  // The picked requests stay picked between openings; only ones that no longer
  // exist are dropped
  growTypes.value = growTypes.value.filter((id) =>
    workspace.templatesById.value.has(id),
  );
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
  workspace.checkpoint();
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
  workspace.checkpoint();
  const removed = workspace.deleteSequence(target.id);
  sdk.window.showToast(`Deleted ${removed} sequence(s)`, {
    variant: "success",
  });
};

// Steps in each sequence's subtree, in one preorder pass over the rows. The old
// recursive scan filtered every sequence per node, so a right-click on a parent
// of a 2k tree spent seconds counting.
const subtreeSteps = computed(() => {
  const counts = new Map<string, number>();
  const stack: { id: string; depth: number; steps: number }[] = [];
  const close = () => {
    const done = stack.pop();
    if (done === undefined) return;
    counts.set(done.id, done.steps);
    const parent = stack[stack.length - 1];
    if (parent !== undefined) parent.steps += done.steps;
  };
  for (const row of workspace.rows.value) {
    while (
      stack.length > 0 &&
      (stack[stack.length - 1]?.depth ?? -1) >= row.depth
    ) {
      close();
    }
    stack.push({
      id: row.sequence.id,
      depth: row.depth,
      steps: row.sequence.steps.length,
    });
  }
  while (stack.length > 0) close();
  return counts;
});

const rerenderTarget = async () => {
  const target = extendTarget.value;
  if (target === undefined) return;
  const confirmed = window.confirm(
    `Re-render "${workspace.sequenceLabel(target)}" and every sequence under it from its templates? Manual step edits will be replaced.`,
  );
  if (!confirmed) return;
  workspace.checkpoint();
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

const menuItems = computed(() => {
  if (menuOnBatch.value) {
    return [
      {
        label: `Extend ${selected.value.size} selected`,
        icon: "fas fa-plus",
        command: () => openGrow(topSelected.value),
      },
      {
        label: "Rerender",
        icon: "fas fa-rotate",
        disabled: topSelected.value.length === 0,
        command: rerenderSelected,
      },
      {
        label: "Delete",
        icon: "fas fa-trash",
        disabled: topSelected.value.every((s) => s.parentId === undefined),
        command: deleteSelected,
      },
      {
        label: "Clear selection",
        icon: "fas fa-xmark",
        command: () => (selected.value = new Set()),
      },
    ];
  }
  return [
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
        (subtreeSteps.value.get(extendTarget.value.id) ?? 0) === 0,
      command: rerenderTarget,
    },
    {
      label: "Make subtree",
      icon: "fas fa-diagram-project",
      disabled:
        extendTarget.value?.parentId === undefined ||
        workspace.state.trees.some(
          (tree) => tree.id === extendTarget.value?.id,
        ),
      command: makeSubtreeTarget,
    },
    {
      label: "Copy id",
      icon: "fas fa-copy",
      disabled: extendTarget.value === undefined,
      command: copyTargetId,
    },
    {
      label: "Delete",
      icon: "fas fa-trash",
      disabled: extendTarget.value?.parentId === undefined,
      command: deleteTarget,
    },
  ];
});

const copyTargetId = async () => {
  const target = extendTarget.value;
  if (target === undefined) return;
  try {
    await navigator.clipboard.writeText(target.id);
    sdk.window.showToast(`Copied id ${target.id}`, { variant: "success" });
  } catch {
    sdk.window.showToast("Could not copy to the clipboard", {
      variant: "error",
    });
  }
};

// A subtree shows the clicked sequence and everything under it, in its own tree
const makeSubtreeTarget = () => {
  const target = extendTarget.value;
  if (target === undefined) return;
  workspace.checkpoint();
  workspace.makeSubtree(target.id);
};

// Right-clicking a batch-selected row acts on the whole batch
const menuOnBatch = ref(false);

const openMenu = (event: MouseEvent, sequence: Sequence) => {
  extendTarget.value = sequence;
  menuOnBatch.value = selected.value.has(sequence.id);
  focusId.value = sequence.id;
  workspace.selectSequence(sequence.id);
  menu.value?.show(event);
};

// Landing on the request a sequence is named after
const openSequence = (sequence: Sequence) => {
  workspace.selectSequence(sequence.id);
  workspace.setFocusStep(sequence.steps[sequence.steps.length - 1]?.id);
  emit("openSequence", sequence.id);
};

// Clicking a sequence's name or method highlights it and its path; clicking it
// again opens it. Shift-click batches the sequence and its children instead.
// Ctrl+Shift-click batches only the children, leaving the sequence itself out.
const clickRow = (sequence: Sequence, event: MouseEvent) => {
  if (event.shiftKey && event.ctrlKey) {
    toggleDescendants(sequence.id);
    return;
  }
  if (event.shiftKey) {
    toggleSubtree(sequence.id);
    return;
  }
  // Ctrl-click shows or hides everything below the sequence
  if (event.ctrlKey) {
    if (hasChildren(sequence.id)) toggleCollapsed(sequence.id);
    return;
  }
  if (sequence.id === focusId.value) {
    openSequence(sequence);
  } else {
    focusId.value = sequence.id;
    workspace.selectSequence(sequence.id);
  }
};

// Clicking anywhere else in a row clears the highlight and the batch
const clearHighlight = () => {
  focusId.value = undefined;
  selected.value = new Set();
};
</script>

<template>
  <div class="h-full flex flex-col gap-3 p-3">
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <Select
          :model-value="workspace.state.selectedTreeId"
          :options="workspace.state.trees"
          option-label="name"
          option-value="id"
          size="small"
          class="w-48"
          @update:model-value="pickTree"
        />
        <Button
          label="New"
          size="small"
          severity="secondary"
          icon="fas fa-plus"
          @click="openTreeDialog('create')"
        />
        <Button
          label="Rename"
          size="small"
          severity="secondary"
          :disabled="workspace.state.selectedTreeId === undefined"
          @click="openTreeDialog('rename')"
        />
        <Button
          label="Delete"
          size="small"
          severity="danger"
          icon="fas fa-trash"
          :disabled="workspace.state.trees.length <= 1"
          @click="deleteCurrentTree"
        />
      </div>
      <div class="flex items-center gap-2">
        <InputText
          v-model="pattern"
          placeholder="Query, e.g. `(?s)^POST /api/v4/users/login` OR children(abc123)"
          size="small"
          class="flex-1 font-mono"
          spellcheck="false"
        />
        <span
          v-if="queryResult?.kind === 'error'"
          class="text-xs text-red-400 truncate max-w-80"
          :title="queryResult.message"
        >
          {{ queryResult.message }}
        </span>
        <span v-else class="text-xs text-surface-500 whitespace-nowrap">
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
          <button
            type="button"
            aria-label="Highlight all leaves"
            class="px-1.5 py-1 text-surface-400 hover:text-surface-100"
            @click="selectLeaves"
          >
            <i class="fas fa-leaf" />
          </button>
        </div>
      </div>
      <details class="text-xs text-surface-400">
        <summary class="cursor-pointer">Query usage</summary>
        <p class="py-1">
          Terms: <code>`regex`</code> matches each whole sequence (its requests,
          then full responses, joined by \x1e); <code>node(id, ...)</code> is
          those sequences; <code>children(id, ...)</code> is their immediate
          children. Join terms with AND or OR (AND binds tighter), group with
          parentheses. Start a regex with (?s) so . matches newlines, or (?m) so
          ^ and $ match each line. Right-click a row and choose Copy id to get
          an id.
        </p>
        <pre class="whitespace-pre-wrap break-all font-mono py-1">
children(abc123) OR `(?s)^POST /api/v4/users/login`</pre>
      </details>
    </div>

    <div class="flex-1 min-h-0 flex flex-col">
      <div
        v-if="stickyRows.length > 0"
        class="shrink-0 border-b border-surface-700 bg-surface-900"
      >
        <button
          v-for="row in stickyRows"
          :key="row.sequence.id"
          type="button"
          class="w-full flex items-center gap-2 pr-3 text-left text-surface-400 hover:text-surface-200 select-none outline-none"
          :style="{
            fontSize: `${fontSize}px`,
            height: `${rowPx}px`,
            paddingLeft: `calc(0.75rem + ${row.depth * indent}rem)`,
          }"
          @click="clickSticky(row, $event)"
        >
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
            v-if="statusOf(row.sequence) !== undefined"
            class="shrink-0 font-bold"
            :class="statusColor(statusOf(row.sequence) ?? '')"
            >{{ statusOf(row.sequence) }}</span
          >
        </button>
      </div>
      <div
        ref="treeScroll"
        class="flex-1 min-h-0 overflow-auto"
        @scroll="onTreeScroll"
        @pointerdown="onPress"
        @click.capture="onClickCapture"
      >
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
        <div :style="{ height: `${topSpacerPx}px` }" />
        <button
          v-for="row in renderedRows"
          :key="row.sequence.id"
          :data-row-id="row.sequence.id"
          type="button"
          class="w-full flex items-center pl-3 pr-3 text-left select-none outline-none"
          :style="{
            fontSize: `${fontSize}px`,
            height: `max(1.75rem, ${fontSize * 2}px)`,
          }"
          :class="
            litIds.has(row.sequence.id)
              ? 'text-amber-200 font-bold'
              : 'text-surface-300 hover:bg-surface-800'
          "
          @click="clearHighlight"
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
              v-if="
                lane < row.depth - 1 && guideOf(row.sequence.id).guides[lane]
              "
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
                  litIds.has(row.sequence.id)
                    ? 'border-amber-400'
                    : 'border-surface-600'
                "
                :style="{ width: `calc(${indent / 2}rem + 1rem)` }"
              />
            </template>
          </span>
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <span
              class="relative flex h-full w-4 shrink-0 items-center justify-center"
            >
              <i
                v-if="row.depth === 0"
                class="fas fa-folder text-surface-500"
              />
              <template v-if="!filtering && hasChildren(row.sequence.id)">
                <span
                  class="absolute top-1/2 bottom-0 left-1/2 border-l"
                  :class="trunkColor(row.sequence.id)"
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
              @click.stop="clickRow(row.sequence, $event)"
              >{{ workspace.sequenceMethod(row.sequence) }}</span
            >
            <span
              class="truncate"
              @click.stop="clickRow(row.sequence, $event)"
              >{{ workspace.sequencePath(row.sequence) }}</span
            >
            <span
              v-if="statusOf(row.sequence) !== undefined"
              class="shrink-0 font-bold"
              :class="statusColor(statusOf(row.sequence) ?? '')"
              >{{ statusOf(row.sequence) }}</span
            >
            <span
              v-if="subtreeName(row.sequence.id) !== undefined"
              class="shrink-0 cursor-pointer rounded border border-sky-700 px-1.5 text-xs text-sky-300 hover:bg-sky-900"
              @click.stop="workspace.selectTree(row.sequence.id)"
              >{{ subtreeName(row.sequence.id) }}</span
            >
            <span
              v-if="!filtering && isCollapsed(row.sequence.id)"
              class="text-xs text-surface-500 whitespace-nowrap"
            >
              ({{ descendantCounts.get(row.sequence.id) }} hidden)
            </span>
            <span class="ml-auto text-xs text-surface-500">
              {{ row.sequence.steps.length }} steps
            </span>
          </div>
        </button>
        <div :style="{ height: `${bottomSpacerPx}px` }" />
      </div>
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
          placeholder="Search method or URL"
          size="small"
          autofocus
        />
        <div class="max-h-80 overflow-auto flex flex-col">
          <div
            v-if="growGroups.length === 0"
            class="py-6 text-center text-surface-400"
          >
            No request templates match
          </div>
          <div
            v-for="group in growGroups"
            :key="group.collection.id"
            class="flex flex-col"
          >
            <div class="flex items-center gap-1 hover:bg-surface-800">
              <button
                type="button"
                class="w-6 shrink-0 py-1.5 text-xs text-surface-400"
                @click="toggleFolded(group.collection.id)"
              >
                <i
                  :class="
                    collapsedCollections.has(group.collection.id)
                      ? 'fas fa-chevron-right'
                      : 'fas fa-chevron-down'
                  "
                />
              </button>
              <label
                class="flex min-w-0 flex-1 items-center gap-3 py-1.5 pr-3 text-sm font-semibold text-surface-100"
              >
                <input
                  type="checkbox"
                  :checked="collectionState(group.templates) === 'all'"
                  :indeterminate.prop="
                    collectionState(group.templates) === 'some'
                  "
                  @change="toggleCollection(group.templates)"
                />
                <i class="fas fa-folder text-surface-500" />
                <span class="truncate">{{ group.collection.name }}</span>
                <span class="ml-auto text-xs text-surface-500">{{
                  group.templates.length
                }}</span>
              </label>
            </div>
            <template v-if="!collapsedCollections.has(group.collection.id)">
              <label
                v-for="template in group.templates"
                :key="template.id"
                class="flex items-center gap-3 py-1.5 pl-9 pr-3 text-sm hover:bg-surface-800"
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
            </template>
          </div>
        </div>
        <div
          class="flex items-center justify-between gap-2 border-t border-surface-700 pt-3 text-sm"
        >
          <span class="text-surface-400">
            Up to {{ growEstimate }} sequence(s)
          </span>
          <Button
            v-if="growRunning"
            :label="growStopRequested ? 'Stopping…' : 'Stop'"
            :disabled="growStopRequested"
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
      v-model:visible="treeDialogVisible"
      modal
      :header="treeDialogMode === 'create' ? 'New tree' : 'Rename tree'"
      :style="{ width: '22rem' }"
    >
      <form class="flex flex-col gap-3" @submit.prevent="saveTree">
        <InputText v-model="treeName" size="small" autofocus />
        <div class="flex justify-end">
          <Button
            type="submit"
            label="Save"
            size="small"
            :disabled="treeName.trim() === ''"
          />
        </div>
      </form>
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
