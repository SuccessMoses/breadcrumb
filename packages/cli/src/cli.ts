#!/usr/bin/env node
import { existsSync } from "node:fs";

import { type Flags, run } from "./commands";
import { openStore } from "./store";

const USAGE = `Usage: breadcrumb <project.json> <command> [options]

Reading
  add <file.http>                    add a request template from a file
  templates                          list request templates
  sequences                          list every sequence
  tree-summary                       size and shape of the trees
  tree [--under ID] [--depth N] [--limit N] [--cursor N]
                                     one page of a tree, depth first
  find <text> [--limit N]            sequences that mention the text
  path <sequence-id>                 labels from the root down to a sequence
  show <sequence-id> [--max-bytes N] [--full]
                                     steps, requests and responses
  check <template-id>                problems with a template's request
  preview <template-id> [--sequence ID]
                                     the requests it would send, without sending

Sending
  extend <parent-id> <template-id>   send a template after a sequence
  grow --from IDS --templates IDS [--generations N] [--max N] [--ready-only]
                                     send templates after many sequences, with a cap
  rerun <sequence-id>                send every step of a sequence again

Other
  init                               create an empty project file

Options
  --json                             print JSON
  --ready-only                       grow only from sequences whose requests were sent
  --insecure                         accept certificates that do not verify
  --tls / --plain                    force TLS on or off for a request
`;

// Flags that take a value; every other --flag is on or off
const VALUED = new Set([
  "under",
  "depth",
  "limit",
  "cursor",
  "sequence",
  "max-bytes",
  "from",
  "templates",
  "generations",
  "max",
]);

const parse = (argv: string[]) => {
  const positionals: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
    } else if (VALUED.has(arg.slice(2))) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      flags[arg.slice(2)] = value;
    } else {
      flags[arg.slice(2)] = true;
    }
  }
  return { positionals, flags };
};

const main = async (): Promise<number> => {
  const { positionals, flags } = parse(process.argv.slice(2));
  const [file, command, ...args] = positionals;
  if (flags.help === true || file === undefined || command === undefined) {
    process.stdout.write(USAGE);
    return flags.help === true ? 0 : 2;
  }

  const options = {
    insecure: flags.insecure === true,
    tls: flags.tls === true ? true : flags.plain === true ? false : undefined,
  };

  if (command === "init") {
    if (existsSync(file)) throw new Error(`${file} already exists`);
    openStore(file, options).save();
    process.stdout.write(`Created ${file}\n`);
    return 0;
  }
  if (!existsSync(file))
    throw new Error(`${file} does not exist, run init first`);

  return run(command, args, flags, openStore(file, options));
};

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
