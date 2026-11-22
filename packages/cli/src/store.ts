import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import {
  type CoreWorkspace,
  createCore,
  emptyState,
  isState,
  type WorkspaceState,
} from "@caido-community/breadcrumb-core";

import { type SendOptions, sendRaw } from "./send";

// The file a project is kept in is a Breadcrumb backup, the same JSON the
// plugin exports
const FORMAT = "breadcrumb-backup";

export type Store = {
  core: CoreWorkspace;
  state: WorkspaceState;
  // Writes the project to its file
  save: () => void;
};

// A value that is rebuilt only when the list it is made from changes
const indexed = <T extends { id: string }>(list: () => T[]) => {
  let cache: { source: T[]; size: number; map: Map<string, T> } | undefined;
  return {
    get value() {
      const source = list();
      if (
        cache === undefined ||
        cache.source !== source ||
        cache.size !== source.length
      ) {
        cache = {
          source,
          size: source.length,
          map: new Map(source.map((item) => [item.id, item])),
        };
      }
      return cache.map;
    },
  };
};

const readStored = (file: string): unknown => {
  if (!existsSync(file)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("format" in parsed) ||
    parsed.format !== FORMAT ||
    !("state" in parsed) ||
    !isState(parsed.state)
  ) {
    throw new Error(`${file} is not a Breadcrumb backup`);
  }
  return parsed.state;
};

// Opens a project file. Each change is written as soon as it is made.
export const openStore = (file: string, options: SendOptions): Store => {
  const stored = readStored(file);
  const state = emptyState();

  const save = () => {
    const text = JSON.stringify(
      {
        format: FORMAT,
        version: 1,
        exportedAt: new Date().toISOString(),
        state: core.state,
      },
      null,
      2,
    );
    // Written beside the file and renamed, so an interrupted write cannot
    // leave a half-written project behind
    writeFileSync(`${file}.tmp`, `${text}\n`);
    renameSync(`${file}.tmp`, file);
  };

  const core = createCore({
    state,
    adapter: {
      load: () => stored,
      save: () => save(),
      sendRaw: (raw) => sendRaw(raw, options),
      notify: (message) => {
        process.stderr.write(`${message}\n`);
      },
      schedule: (run) => {
        run();
        return () => {};
      },
    },
    focusStep: { value: undefined },
    focusTemplate: { value: undefined },
    templatesById: indexed(() => state.templates),
    sequencesById: indexed(() => state.sequences),
  });

  return { core, state, save };
};
