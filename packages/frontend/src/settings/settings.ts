import type { FrontendSDK } from "@/types";

type TreeSettings = {
  // Width of one level of the tree, in rem
  indent: number;
};

export const DEFAULT_TREE_SETTINGS: TreeSettings = { indent: 3 };

const MIN_INDENT = 0.5;
const MAX_INDENT = 6;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Storage holds the workspace snapshots under "projects"; settings sit beside them
const readRoot = (sdk: FrontendSDK): Record<string, unknown> => {
  const value: unknown = sdk.storage.get();
  return isRecord(value) ? value : {};
};

const cleanTreeSettings = (value: TreeSettings): TreeSettings => ({
  indent: Number.isFinite(value.indent)
    ? Math.min(MAX_INDENT, Math.max(MIN_INDENT, value.indent))
    : DEFAULT_TREE_SETTINGS.indent,
});

export const loadTreeSettings = (sdk: FrontendSDK): TreeSettings => {
  const root = readRoot(sdk);
  const settings = isRecord(root.settings) ? root.settings : {};
  const tree = isRecord(settings.tree) ? settings.tree : {};
  const indent = typeof tree.indent === "number" ? tree.indent : NaN;
  return cleanTreeSettings({ indent });
};

export const saveTreeSettings = (
  sdk: FrontendSDK,
  value: TreeSettings,
): void => {
  const root = readRoot(sdk);
  const settings = isRecord(root.settings) ? root.settings : {};
  sdk.storage.set({
    ...root,
    settings: { ...settings, tree: cleanTreeSettings(value) },
  });
};
