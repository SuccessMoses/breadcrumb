<script setup lang="ts">
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import { computed, ref } from "vue";

import { useSDK } from "@/plugins/sdk";
import type { Workspace } from "@/workspace/workspace";

const { workspace } = defineProps<{ workspace: Workspace }>();

const sdk = useSDK();

const search = ref("");

const sequenceById = computed(
  () => new Map(workspace.state.sequences.map((s) => [s.id, s])),
);

const timeOf = (time: number) => new Date(time).toLocaleString();

// Everything an entry can be searched by: its date and time as shown, as a
// timestamp and as ISO text, then its script, sequence id, rule and message
const haystackOf = (log: (typeof workspace.state.logs)[number]) =>
  [
    timeOf(log.time),
    String(log.time),
    new Date(log.time).toISOString(),
    log.scriptName,
    log.sequenceId,
    log.ruleName,
    log.message,
  ]
    .join("\n")
    .toLowerCase();

// Newest first, narrowed to the entries that contain the search text. An empty
// search keeps every entry.
const rows = computed(() => {
  const term = search.value.trim().toLowerCase();
  return workspace.state.logs
    .slice()
    .reverse()
    .filter((log) => term === "" || haystackOf(log).includes(term))
    .map((log) => ({
      log,
      sequence: sequenceById.value.get(log.sequenceId),
    }));
});

const totalCount = computed(() => workspace.state.logs.length);

// The distinct sequence ids of the shown entries in list order, as
// "id1, id2, id3" to paste into node(...) or delete(...)
const copyAll = async () => {
  const ids = [...new Set(rows.value.map((row) => row.log.sequenceId))];
  try {
    await navigator.clipboard.writeText(ids.join(", "));
    sdk.window.showToast(`Copied ${ids.length} id(s)`, { variant: "success" });
  } catch {
    sdk.window.showToast("Could not copy to the clipboard", {
      variant: "error",
    });
  }
};
</script>

<template>
  <div class="h-full flex flex-col gap-3 p-3 overflow-auto">
    <div class="flex items-center gap-2">
      <InputText
        v-model="search"
        placeholder="Search date, script, sequence id, rule or message"
        size="small"
        class="flex-1 min-w-0"
      />
      <Button
        label="Copy all"
        icon="fas fa-copy"
        size="small"
        text
        :disabled="rows.length === 0"
        @click="copyAll"
      />
      <Button
        label="Clear"
        icon="fas fa-eraser"
        size="small"
        severity="danger"
        text
        :disabled="totalCount === 0"
        @click="workspace.clearLogs()"
      />
    </div>

    <div class="text-sm text-surface-400 px-1">
      <template v-if="search.trim() === ''">
        {{ totalCount }} {{ totalCount === 1 ? "entry" : "entries" }}, newest
        first. Each Extend logs the message of the first rule a new sequence
        matches.
      </template>
      <template v-else>
        {{ rows.length }} of {{ totalCount }} entries match. Copy all copies the
        sequence ids of these.
      </template>
    </div>

    <div v-if="totalCount === 0" class="text-surface-400 text-sm px-1">
      No log entries yet.
    </div>
    <div v-else-if="rows.length === 0" class="text-surface-400 text-sm px-1">
      No entries match the search.
    </div>

    <div
      v-for="row in rows"
      :key="row.log.id"
      class="flex flex-col gap-1 p-3 rounded surface-800"
    >
      <div class="text-sm">{{ row.log.message }}</div>
      <div class="text-xs text-surface-400 font-mono break-all">
        {{ timeOf(row.log.time) }} &middot; {{ row.log.scriptName }} &middot;
        {{ row.log.ruleName }} &middot;
        {{
          row.sequence === undefined
            ? `sequence ${row.log.sequenceId} (removed)`
            : workspace.sequenceLabel(row.sequence)
        }}
      </div>
    </div>
  </div>
</template>
