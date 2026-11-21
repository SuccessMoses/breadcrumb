import type {
  CoreWorkspace,
  WorkspaceState,
} from "@caido-community/breadcrumb-core";
import type { Sequence } from "shared";

// One sequence as an agent reads it: where it sits and what it sends
type Node = {
  id: string;
  parentId: string | undefined;
  depth: number;
  children: number;
  method: string | undefined;
  path: string;
  label: string;
};

// The sequences below one root, in the order they were created, with depths
// counted from the root
const walk = (state: WorkspaceState, rootId: string, maxDepth?: number) => {
  const childrenOf = new Map<string, Sequence[]>();
  for (const sequence of state.sequences) {
    if (sequence.parentId === undefined) continue;
    const siblings = childrenOf.get(sequence.parentId) ?? [];
    siblings.push(sequence);
    childrenOf.set(sequence.parentId, siblings);
  }
  const byId = new Map(state.sequences.map((s) => [s.id, s]));
  const out: { sequence: Sequence; depth: number }[] = [];
  const root = byId.get(rootId);
  if (root === undefined) return { out, childrenOf };
  const stack: { sequence: Sequence; depth: number }[] = [
    { sequence: root, depth: 0 },
  ];
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined) break;
    out.push(next);
    if (maxDepth !== undefined && next.depth >= maxDepth) continue;
    const children = childrenOf.get(next.sequence.id) ?? [];
    // Pushed in reverse so the first child is visited first
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child !== undefined)
        stack.push({ sequence: child, depth: next.depth + 1 });
    }
  }
  return { out, childrenOf };
};

export const nodeOf = (
  core: CoreWorkspace,
  state: WorkspaceState,
  sequence: Sequence,
  depth: number,
  childCount: number,
): Node => ({
  id: sequence.id,
  parentId: sequence.parentId,
  depth,
  children: childCount,
  method: core.sequenceMethod(sequence),
  path: core.sequencePath(sequence),
  label: core.sequenceLabel(sequence),
});

// The root a tree command starts from: the given sequence, else the selected
// tree, else the first root
const defaultRoot = (
  state: WorkspaceState,
  under?: string,
): string | undefined => {
  if (under !== undefined) return under;
  if (state.selectedTreeId !== undefined) return state.selectedTreeId;
  return state.sequences.find((s) => s.parentId === undefined)?.id;
};

export const summary = (core: CoreWorkspace, state: WorkspaceState) => {
  const roots = state.sequences.filter((s) => s.parentId === undefined);
  const depthCounts: number[] = [];
  let maxDepth = 0;
  const fanout: { node: Node; children: number }[] = [];
  let leaves = 0;
  for (const root of roots) {
    const { out, childrenOf } = walk(state, root.id);
    for (const { sequence, depth } of out) {
      depthCounts[depth] = (depthCounts[depth] ?? 0) + 1;
      maxDepth = Math.max(maxDepth, depth);
      const children = childrenOf.get(sequence.id)?.length ?? 0;
      if (children === 0) leaves++;
      if (children > 0)
        fanout.push({
          node: nodeOf(core, state, sequence, depth, children),
          children,
        });
    }
  }
  fanout.sort((a, b) => b.children - a.children);
  return {
    sequences: state.sequences.length,
    roots: roots.length,
    trees: state.trees.length,
    templates: state.templates.length,
    maxDepth,
    leaves,
    depthCounts: depthCounts.map((count, depth) => ({ depth, count })),
    widest: fanout
      .slice(0, 10)
      .map((entry) => ({ ...entry.node, children: entry.children })),
  };
};

// A page of nodes under a root, depth first. The cursor is the position in the
// full listing, so the next page starts where this one ended.
export const page = (
  core: CoreWorkspace,
  state: WorkspaceState,
  options: { under?: string; depth?: number; limit: number; cursor: number },
) => {
  const root = defaultRoot(state, options.under);
  if (root === undefined) return { total: 0, items: [], nextCursor: undefined };
  const { out, childrenOf } = walk(state, root, options.depth);
  const items = out
    .slice(options.cursor, options.cursor + options.limit)
    .map(({ sequence, depth }) =>
      nodeOf(
        core,
        state,
        sequence,
        depth,
        childrenOf.get(sequence.id)?.length ?? 0,
      ),
    );
  const next = options.cursor + options.limit;
  return {
    total: out.length,
    items,
    nextCursor: next < out.length ? next : undefined,
  };
};

// How many sequences sit directly below each sequence
const childCounts = (state: WorkspaceState) => {
  const counts = new Map<string, number>();
  for (const sequence of state.sequences) {
    if (sequence.parentId === undefined) continue;
    counts.set(sequence.parentId, (counts.get(sequence.parentId) ?? 0) + 1);
  }
  return counts;
};

// The nodes from the root down to a sequence, with depths counted from the root
export const pathOf = (
  core: CoreWorkspace,
  state: WorkspaceState,
  id: string,
) => {
  const byId = new Map(state.sequences.map((s) => [s.id, s]));
  const counts = childCounts(state);
  const chain: Sequence[] = [];
  let current = byId.get(id);
  while (current !== undefined) {
    chain.unshift(current);
    current =
      current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
  return chain.map((sequence, depth) =>
    nodeOf(core, state, sequence, depth, counts.get(sequence.id) ?? 0),
  );
};

// Sequences whose label, path, method or latest request mention the text
export const find = (
  core: CoreWorkspace,
  state: WorkspaceState,
  text: string,
  limit: number,
) => {
  const needle = text.toLowerCase();
  const hits: Node[] = [];
  const counts = childCounts(state);
  const byId = new Map(state.sequences.map((s) => [s.id, s]));
  // Depth is how many parents a sequence has
  const depthOf = (sequence: Sequence) => {
    let depth = 0;
    let parent = sequence.parentId;
    while (parent !== undefined) {
      depth++;
      parent = byId.get(parent)?.parentId;
    }
    return depth;
  };
  for (const sequence of state.sequences) {
    const last = sequence.steps.at(-1)?.request ?? "";
    const haystack = [
      core.sequenceLabel(sequence),
      core.sequencePath(sequence),
      core.sequenceMethod(sequence) ?? "",
      last.split("\n")[0] ?? "",
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(needle)) continue;
    hits.push(
      nodeOf(
        core,
        state,
        sequence,
        depthOf(sequence),
        counts.get(sequence.id) ?? 0,
      ),
    );
    if (hits.length >= limit) break;
  }
  return hits;
};
