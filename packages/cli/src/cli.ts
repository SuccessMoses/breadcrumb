#!/usr/bin/env node
import { existsSync } from "node:fs";

import { type Flags, run } from "./commands";
import { COMMAND_HELP, GUIDE, USAGE } from "./help";
import { openStore } from "./store";

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
  // Help needs no project file: "help [command]" and "guide" come first
  if (file === "help") {
    if (command === undefined) {
      process.stdout.write(USAGE);
      return 0;
    }
    const text = COMMAND_HELP[command];
    if (text === undefined) {
      process.stderr.write(`unknown command ${command}\n${USAGE}`);
      return 2;
    }
    process.stdout.write(`${text}\n`);
    return 0;
  }
  if (file === "guide") {
    process.stdout.write(GUIDE);
    return 0;
  }
  if (flags.help === true && command !== undefined) {
    process.stdout.write(`${COMMAND_HELP[command] ?? USAGE}\n`);
    return 0;
  }
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
