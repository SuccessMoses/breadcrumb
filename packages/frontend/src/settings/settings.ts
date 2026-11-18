import type { FrontendSDK } from "@/types";

type TreeSettings = {
  // Width of one level of the tree, in rem
  indent: number;
  // Text size of a sequence row, in px
  fontSize: number;
};

export const DEFAULT_TREE_SETTINGS: TreeSettings = { indent: 3, fontSize: 14 };

const MIN_INDENT = 0.5;
const MAX_INDENT = 6;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 24;

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
  fontSize: Number.isFinite(value.fontSize)
    ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value.fontSize))
    : DEFAULT_TREE_SETTINGS.fontSize,
});

export const loadTreeSettings = (sdk: FrontendSDK): TreeSettings => {
  const root = readRoot(sdk);
  const settings = isRecord(root.settings) ? root.settings : {};
  const tree = isRecord(settings.tree) ? settings.tree : {};
  const indent = typeof tree.indent === "number" ? tree.indent : NaN;
  const fontSize = typeof tree.fontSize === "number" ? tree.fontSize : NaN;
  return cleanTreeSettings({ indent, fontSize });
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
