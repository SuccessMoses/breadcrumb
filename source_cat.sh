#!/usr/bin/env bash
# Concatenates every text file under the current directory (node_modules,
# config and package JSON included) into source_dump.txt. Skips .git, binary
# files and the dump itself. Run it from the project root.
set -euo pipefail

out="source_dump.txt"
: > "$out"

find . -path ./.git -prune -o -path "./$out" -prune -o -type f -print0 \
  | sort -z \
  | while IFS= read -r -d '' file; do
      # grep -I skips binary files; empty files have no line to match
      grep -Iq '' "$file" || continue
      printf '\n===== %s =====\n' "$file" >> "$out"
      cat "$file" >> "$out"
    done

echo "Wrote $(wc -l < "$out") lines to $out ($(du -h "$out" | cut -f1))"
