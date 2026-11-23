<script setup lang="ts">
import Button from "primevue/button";
import { computed } from "vue";

import type { Workspace } from "@/workspace/workspace";

const { workspace } = defineProps<{ workspace: Workspace }>();

const sequenceById = computed(
  () => new Map(workspace.state.sequences.map((s) => [s.id, s])),
);

// Newest first
const rows = computed(() =>
  workspace.state.logs
    .slice()
    .reverse()
    .map((log) => ({
      log,
      sequence: sequenceById.value.get(log.sequenceId),
    })),
);

const timeOf = (time: number) => new Date(time).toLocaleString();
</script>

<template>
  <div class="h-full flex flex-col gap-3 p-3 overflow-auto">
    <div class="flex items-center gap-2">
      <div class="flex-1 text-sm text-surface-400">
        {{ rows.length }} {{ rows.length === 1 ? "entry" : "entries" }}, newest
        first. Each Extend logs the message of the first rule a new sequence
        matches.
      </div>
      <Button
        label="Clear"
        icon="fas fa-eraser"
        size="small"
        severity="danger"
        text
        :disabled="rows.length === 0"
        @click="workspace.clearLogs()"
      />
    </div>

    <div v-if="rows.length === 0" class="text-surface-400 text-sm px-1">
      No log entries yet.
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
