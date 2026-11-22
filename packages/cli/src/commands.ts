import { readFileSync } from "node:fs";
import { basename } from "node:path";

import {
  checkHttp,
  displayPath,
  withUpload,
} from "@caido-community/breadcrumb-core";
import { UPLOAD_LIMIT_BYTES } from "shared";

import type { Store } from "./store";
import { find, nodeOf, page, pathOf, summary } from "./tree";

export type Flags = Record<string, string | true>;

// Larger files would make every save of the project slow
const MAX_UPLOAD_BYTES = UPLOAD_LIMIT_BYTES;

// Prints the value as JSON when asked for it, otherwise the text it makes
const print = (json: boolean, value: unknown, text: () => string) => {
  process.stdout.write(
    json ? `${JSON.stringify(value, null, 2)}\n` : `${text()}\n`,
  );
};

const numberFlag = (flags: Flags, name: string, fallback: number): number => {
  const value = flags[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (value === true || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} needs a whole number`);
  }
  return parsed;
};

// Long bodies are cut so one response does not fill an agent's context
const clip = (text: string, max: number) => {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n... (${text.length - max} more characters, use --full)`;
};

const nodeLine = (node: {
  id: string;
  depth: number;
  children: number;
  method?: string | undefined;
  path: string;
  label: string;
}) =>
  `${node.id}  depth ${node.depth}  children ${node.children}  ${node.method ?? "-"} ${node.path}  (${node.label})`;

// Runs one command. Returns the process exit code.
export const run = async (
  command: string,
  args: string[],
  flags: Flags,
  store: Store,
): Promise<number> => {
  const { core, state } = store;
  const json = flags.json === true;

  switch (command) {
    case "add": {
      const file = args[0];
      if (file === undefined) throw new Error("add needs a .http file");
      const id = core.addEmptyTemplate();
      core.setTemplateText(id, readFileSync(file, "utf8"));
      store.save();
      print(json, { id }, () => `added ${id}`);
      return 0;
    }

    case "attach": {
      const [templateId, name, path] = args;
      if (
        templateId === undefined ||
        name === undefined ||
        path === undefined
      ) {
        throw new Error("attach needs a template id, a name and a file");
      }
      if (!/^[A-Za-z_]\w*$/.test(name))
        throw new Error(`${name} is not a name`);
      const text = core.templateText(templateId);
      if (text === undefined) throw new Error(`No template ${templateId}`);
      const bytes = readFileSync(path);
      if (bytes.length > MAX_UPLOAD_BYTES) {
        throw new Error(`${path} is larger than ${MAX_UPLOAD_BYTES} bytes`);
      }
      const filename = basename(path);
      if (filename.includes("|"))
        throw new Error("the file name cannot contain |");
      const upload = { name, filename, data: bytes.toString("base64") };
      const next = withUpload(text, upload);
      core.setTemplateText(templateId, next);
      store.save();
      print(
        json,
        { name, bytes: bytes.length },
        () => `attached ${name} (${bytes.length} bytes)`,
      );
      return 0;
    }

    case "templates": {
      const collections = new Map(state.collections.map((c) => [c.id, c.name]));
      const rendered = core.renderingsOf();
      const items = state.templates.map((template) => ({
        id: template.id,
        method: template.method,
        path: displayPath(template),
        collection: collections.get(core.collectionOf(template.id)) ?? "",
        renderedIn: rendered.get(template.id)?.length ?? 0,
      }));
      print(json, items, () =>
        items
          .map(
            (t) =>
              `${t.id}  ${t.method} ${t.path}  [${t.collection}]  in ${t.renderedIn} sequence(s)`,
          )
          .join("\n"),
      );
      return 0;
    }

    case "sequences": {
      const items = page(core, state, {
        limit: state.sequences.length,
        cursor: 0,
      }).items;
      print(json, items, () => items.map(nodeLine).join("\n"));
      return 0;
    }

    case "tree-summary": {
      const result = summary(core, state);
      print(json, result, () =>
        [
          `sequences ${result.sequences}, roots ${result.roots}, trees ${result.trees}, templates ${result.templates}`,
          `depth ${result.maxDepth}, leaves ${result.leaves}`,
          "per depth:",
          ...result.depthCounts.map((d) => `  ${d.depth}: ${d.count}`),
          "widest:",
          ...result.widest.map((w) => `  ${nodeLine(w)}`),
        ].join("\n"),
      );
      return 0;
    }

    case "tree": {
      const result = page(core, state, {
        under: typeof flags.under === "string" ? flags.under : undefined,
        depth:
          flags.depth === undefined ? undefined : numberFlag(flags, "depth", 0),
        limit: numberFlag(flags, "limit", 50),
        cursor: numberFlag(flags, "cursor", 0),
      });
      print(json, result, () => {
        const lines = result.items.map(nodeLine);
        lines.push(`${result.items.length} of ${result.total}`);
        if (result.nextCursor !== undefined)
          lines.push(`next: --cursor ${result.nextCursor}`);
        return lines.join("\n");
      });
      return 0;
    }

    case "find": {
      const text = args.join(" ");
      if (text === "") throw new Error("find needs some text");
      const hits = find(core, state, text, numberFlag(flags, "limit", 20));
      print(json, hits, () =>
        hits.length === 0 ? "no matches" : hits.map(nodeLine).join("\n"),
      );
      return 0;
    }

    case "path": {
      const id = args[0];
      if (id === undefined) throw new Error("path needs a sequence id");
      const chain = pathOf(core, state, id);
      print(json, chain, () =>
        chain
          .map((node) => `${"  ".repeat(node.depth)}${nodeLine(node)}`)
          .join("\n"),
      );
      return chain.length === 0 ? 1 : 0;
    }

    case "show": {
      const id = args[0];
      const sequence = state.sequences.find((s) => s.id === id);
      if (sequence === undefined) throw new Error(`No sequence ${id ?? ""}`);
      const max =
        flags.full === true
          ? Number.MAX_SAFE_INTEGER
          : numberFlag(flags, "max-bytes", 1500);
      const steps = sequence.steps.map((step) => {
        const status = step.response?.split("\n")[0]?.trim();
        return {
          id: step.id,
          templateId: step.templateId,
          request: clip(step.request, max),
          response:
            step.response === undefined ? undefined : clip(step.response, max),
          status,
          captured: step.captured ?? {},
        };
      });
      print(
        json,
        {
          sequence: nodeOf(
            core,
            state,
            sequence,
            pathOf(core, state, sequence.id).length - 1,
            0,
          ),
          steps,
        },
        () =>
          steps
            .map((step, index) =>
              [
                `step ${index + 1}  ${step.id}  template ${step.templateId}`,
                step.request,
                step.response === undefined
                  ? "(not sent)"
                  : `response: ${step.status ?? ""}\n${step.response}`,
              ].join("\n"),
            )
            .join("\n\n"),
      );
      return 0;
    }

    case "check": {
      const id = args[0];
      const text = id === undefined ? undefined : core.templateText(id);
      if (text === undefined) throw new Error(`No template ${id ?? ""}`);
      const issues = checkHttp(text);
      print(json, issues, () =>
        issues.length === 0
          ? "no problems"
          : issues
              .map(
                (issue) =>
                  `line ${issue.line} ${issue.severity}: ${issue.message}`,
              )
              .join("\n"),
      );
      return 0;
    }

    case "preview": {
      const id = args[0];
      if (id === undefined) throw new Error("preview needs a template id");
      const sequenceId =
        typeof flags.sequence === "string" ? flags.sequence : undefined;
      const result = core.previewTemplate(id, sequenceId);
      if (result.kind === "error") throw new Error(result.message);
      const missing =
        sequenceId === undefined ? [] : core.missingInputs(id, sequenceId);
      print(json, { requests: result.requests, missing }, () =>
        [
          ...result.requests.map(
            (request, index) => `request ${index + 1}:\n${request}`,
          ),
          missing.length > 0 ? `missing: ${missing.join(", ")}` : "",
        ]
          .filter((line) => line !== "")
          .join("\n\n"),
      );
      return 0;
    }

    case "grow": {
      // Each template is sent after each sequence in --from, generation by
      // generation, and growth stops once --max new sequences exist
      const list = (name: string) =>
        typeof flags[name] === "string"
          ? String(flags[name])
              .split(",")
              .filter((item) => item !== "")
          : [];
      const sequenceIds = list("from");
      const templateIds = list("templates");
      if (sequenceIds.length === 0 || templateIds.length === 0) {
        throw new Error(
          "grow needs --from sequence ids and --templates template ids",
        );
      }
      const max = numberFlag(flags, "max", 50);
      const generations = numberFlag(flags, "generations", 1);
      const before = state.sequences.length;
      const result = await core.grow({
        sequenceIds,
        templateIds,
        generations,
        readyOnly: flags["ready-only"] === true,
        stopped: () => state.sequences.length - before >= max,
      });
      store.save();
      print(
        json,
        { ...result, created: state.sequences.length - before },
        () =>
          `created ${state.sequences.length - before}, pruned ${result.pruned}${result.stopped ? ", stopped at --max" : ""}`,
      );
      return 0;
    }

    case "extend": {
      const [parentId, templateId] = args;
      if (parentId === undefined || templateId === undefined) {
        throw new Error("extend needs a parent sequence id and a template id");
      }
      // A template with an input no earlier step captured would send a request
      // with the placeholder still in it, so it is refused instead
      const missing = core.missingInputs(templateId, parentId);
      if (missing.length > 0) {
        throw new Error(`missing inputs: ${missing.join(", ")}`);
      }
      const before = state.sequences.length;
      const error = await core.extendSequence(parentId, templateId);
      store.save();
      if (error !== undefined) {
        print(json, { error }, () => `error: ${error}`);
        return 1;
      }
      const created = state.sequences.slice(before);
      if (created.length === 0) throw new Error("nothing was created");
      const nodes = created.map((sequence) =>
        nodeOf(
          core,
          state,
          sequence,
          pathOf(core, state, sequence.id).length - 1,
          0,
        ),
      );
      print(json, nodes, () =>
        nodes.map((node) => `created ${nodeLine(node)}`).join("\n"),
      );
      return 0;
    }

    case "rerun": {
      const id = args[0];
      if (id === undefined) throw new Error("rerun needs a sequence id");
      const result = await core.rerenderSequence(id);
      store.save();
      print(json, result, () =>
        result.error === undefined
          ? `rerun ${result.sequences} sequence(s), ${result.steps} step(s)`
          : `error: ${result.error}`,
      );
      return result.error === undefined ? 0 : 1;
    }

    default:
      throw new Error(`Unknown command ${command}. Run with --help.`);
  }
};
