// Text the CLI prints for agents: the command list, one entry per command, and
// the workflow the commands are meant for

export const USAGE = `Usage: breadcrumb <project.json> <command> [options]
       breadcrumb help [command]
       breadcrumb guide

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
  help [command]                     this list, or one command in detail
  guide                              how the commands fit together

Options
  --json                             print JSON
  --ready-only                       grow only from sequences whose requests were sent
  --insecure                         accept certificates that do not verify
  --tls / --plain                    force TLS on or off for a request
`;

export const COMMAND_HELP: Record<string, string> = {
  init: "breadcrumb <project.json> init\n  Creates an empty project file. Refuses if the file exists.",
  add: 'breadcrumb <project.json> add <file.http>\n  Adds a request template from a raw HTTP file. Lines starting with "# ``" are\n  template commands (see guide). Prints the new template id.',
  templates:
    "breadcrumb <project.json> templates [--json]\n  Lists templates with id, method, path, collection and how many sequences\n  they have been rendered into.",
  sequences:
    "breadcrumb <project.json> sequences [--json]\n  Lists every sequence, flat, in creation order. Use tree for the hierarchy.",
  "tree-summary":
    "breadcrumb <project.json> tree-summary [--json]\n  Counts sequences, roots and depth, and how many sequences sit at each depth.\n  Run this first to size a tree before paging through it.",
  tree: "breadcrumb <project.json> tree [--under ID] [--depth N] [--limit N] [--cursor N] [--json]\n  One page of a tree, depth first. --under starts at a sequence, --depth stops\n  below that depth, --limit is the page size (default 50), --cursor the offset.\n  --json returns { total, items, nextCursor }. Each item has id, depth,\n  children (count), method, path and label. A leaf is an item with children 0.\n  Keep passing nextCursor until it is absent.",
  find: "breadcrumb <project.json> find <text> [--limit N] [--json]\n  Sequences whose requests or responses contain the text (default limit 20).",
  path: "breadcrumb <project.json> path <sequence-id> [--json]\n  The labels from the root down to the sequence.",
  show: "breadcrumb <project.json> show <sequence-id> [--max-bytes N] [--full] [--json]\n  Every step with its request and response. Bodies are cut to --max-bytes\n  unless --full is given.",
  check:
    "breadcrumb <project.json> check <template-id> [--json]\n  Reports problems with a template's request, such as an invalid capture regex.",
  preview:
    "breadcrumb <project.json> preview <template-id> [--sequence ID] [--json]\n  The requests the template would send, filled in, without sending them. With\n  --sequence, the values come from that sequence's steps.",
  extend:
    "breadcrumb <project.json> extend <parent-id> <template-id> [--json]\n  Sends the parent's steps again, then the template, and creates a child for\n  each rendering. Refuses with \"missing inputs\" when a placeholder has no value.\n  Each child is saved with copies of the parent's steps.",
  grow: "breadcrumb <project.json> grow --from IDS --templates IDS [--generations N] [--max N] [--ready-only] [--json]\n  Extends every sequence in --from with every template in --templates, then\n  repeats from the children for N generations (default 1). IDS are comma\n  separated. --max caps the new sequences (default 50). --ready-only skips a\n  template where an input is missing instead of refusing. A child whose request\n  fails is pruned. Prints created, pruned and whether it stopped at the cap.",
  rerun:
    "breadcrumb <project.json> rerun <sequence-id> [--json]\n  Sends every step of the sequence again, in order, and updates its requests,\n  responses and captures.",
};

export const GUIDE = `breadcrumb guide

Projects
  A project is one JSON file. init creates it; every command saves to it.

Templates
  add loads a raw HTTP request. Its placeholders are filled from earlier steps:
    {{name}}        the last value captured or seeded for name
    {{name|1}}      the first value, {{name|2}} the second
    {{name|*}}      one child for each value (fans out)
  A comment line starts with "# " and is never sent. Template commands also start
  with "# " and are read as commands:
    # \`\`dict name = a, b          seed values for name
    # \`\`dict name from REGEX      take the last group of each match in the response
    # \`\`set send_when_rendered = false   render without sending it

Finding sequences
  tree-summary sizes the trees. tree --json pages through them and gives leaves
  (children 0). find and show look inside sequences. path shows where one sits.

Sending
  extend sends one template after one sequence. Refuses when inputs are missing.
  grow sends many templates after many sequences, for several generations.
  rerun sends a sequence again. Requests go out over a raw socket; use --tls,
  --plain or --insecure when the defaults are wrong.

Typical flow
  1. breadcrumb p.json init; add login.http; add job.http
  2. breadcrumb p.json extend <root-id> <login-id>
  3. breadcrumb p.json tree-summary, then tree --json to find leaves
  4. breadcrumb p.json grow --from <leaf,leaf> --templates <a,b> --generations 2 --max 500 --ready-only
  5. breadcrumb p.json show <sequence-id> to read what was sent and captured
`;
