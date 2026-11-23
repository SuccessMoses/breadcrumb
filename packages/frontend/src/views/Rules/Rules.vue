<script setup lang="ts">
import { runQuery, sequenceTexts } from "@caido-community/breadcrumb-core";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import { computed, type Directive, ref } from "vue";

import type { Workspace } from "@/workspace/workspace";

const { workspace } = defineProps<{ workspace: Workspace }>();

// Sizes a textarea to its content, when it mounts and whenever its value changes
// A hidden tab measures as zero height, so the box is fitted again whenever its
// width changes, which is also when the tab is first shown
const fit = (el: HTMLTextAreaElement) => {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
};
const observers = new WeakMap<HTMLTextAreaElement, ResizeObserver>();
const vFit: Directive<HTMLTextAreaElement> = {
  mounted(el) {
    fit(el);
    let width = el.clientWidth;
    // eslint-disable-next-line compat/compat -- Caido runs in Chromium, which has it
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit(el);
    });
    observer.observe(el);
    observers.set(el, observer);
  },
  updated: fit,
  unmounted(el) {
    observers.get(el)?.disconnect();
    observers.delete(el);
  },
};
const fitOnInput = (event: Event) => fit(event.target as HTMLTextAreaElement);
const repatternFromInput = (ruleId: string, event: Event) => {
  repatternRule(ruleId, (event.target as HTMLTextAreaElement).value);
  fitOnInput(event);
};

// A new rule, held in the form until it is added
const newName = ref("");
const newPattern = ref("");

const addRule = () => {
  if (newName.value.trim() === "") return;
  workspace.createSeqRule(newName.value, newPattern.value);
  newName.value = "";
  newPattern.value = "";
};

const renameRule = (ruleId: string, name: string) =>
  workspace.updateSeqRule(ruleId, { name });
const repatternRule = (ruleId: string, pattern: string) =>
  workspace.updateSeqRule(ruleId, { pattern });

// Each rule with what its pattern matches over the stringified sequences
const texts = computed(() => sequenceTexts(workspace.state.sequences));

const rows = computed(() =>
  workspace.state.seqRules.map((rule) => {
    const result =
      rule.pattern.trim() === ""
        ? { kind: "ok" as const, ids: new Set<string>() }
        : runQuery(rule.pattern, workspace.state.sequences, texts.value);
    const matches =
      result.kind === "ok"
        ? workspace.state.sequences.filter((s) => result.ids.has(s.id))
        : [];
    return { rule, result, matches };
  }),
);
</script>

<template>
  <div class="h-full flex flex-col gap-3 p-3 overflow-auto">
    <div class="flex flex-col gap-2 p-3 rounded surface-800">
      <div class="text-sm text-surface-400">
        Terms: `regex` matches each whole sequence (requests and full
        responses); node(id, ...) is those sequences; children(id, ...) is their
        immediate children. Combine with AND and OR, group with parentheses.
        Start a regex with (?s) to let dot match newlines, or (?m) to let ^ and
        $ match each line. Example: children(abc123) OR `(?s)POST /api/v4/posts`
      </div>
      <div class="flex gap-2 items-start">
        <InputText
          v-model="newName"
          placeholder="Rule name"
          size="small"
          class="w-40"
          @keydown.enter="addRule"
        />
        <textarea
          v-model="newPattern"
          v-fit
          placeholder="Query, e.g. node(abc123) OR `POST /api`"
          rows="1"
          class="p-inputtext flex-1 min-w-0 font-mono break-all overflow-hidden resize-none"
          @input="fitOnInput"
          @keydown.enter.prevent="addRule"
        />
        <Button
          label="Add rule"
          size="small"
          icon="fas fa-plus"
          :disabled="newName.trim() === ''"
          @click="addRule"
        />
      </div>
    </div>

    <div v-if="rows.length === 0" class="text-surface-400 text-sm px-1">
      No rules yet.
    </div>

    <div
      v-for="row in rows"
      :key="row.rule.id"
      class="flex flex-col gap-2 p-3 rounded surface-800"
    >
      <div class="flex gap-2 items-start">
        <InputText
          :model-value="row.rule.name"
          size="small"
          class="w-40"
          @update:model-value="renameRule(row.rule.id, $event)"
        />
        <textarea
          v-fit
          :value="row.rule.pattern"
          rows="1"
          class="p-inputtext flex-1 min-w-0 font-mono break-all overflow-hidden resize-none"
          @input="repatternFromInput(row.rule.id, $event)"
        />
        <Button
          icon="fas fa-trash"
          severity="danger"
          size="small"
          text
          aria-label="Delete rule"
          @click="workspace.deleteSeqRule(row.rule.id)"
        />
      </div>
      <div v-if="row.result.kind === 'error'" class="text-sm text-red-400">
        Invalid pattern: {{ row.result.message }}
      </div>
      <div v-else class="text-sm text-surface-400">
        {{ row.matches.length }}
        {{ row.matches.length === 1 ? "sequence matches" : "sequences match" }}
      </div>
      <ul
        v-if="row.result.kind === 'ok' && row.matches.length > 0"
        class="text-sm font-mono text-surface-300 flex flex-col gap-1"
      >
        <li v-for="sequence in row.matches" :key="sequence.id">
          {{ workspace.sequenceLabel(sequence) }}
        </li>
      </ul>
    </div>
  </div>
</template>
