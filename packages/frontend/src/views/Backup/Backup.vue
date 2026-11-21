<script setup lang="ts">
import Button from "primevue/button";
import { ref } from "vue";

import { useSDK } from "@/plugins/sdk";
import type { Workspace } from "@/workspace/workspace";

const { workspace } = defineProps<{ workspace: Workspace }>();

const sdk = useSDK();
const fileInput = ref<HTMLInputElement>();
// A file chosen to import, held until it is confirmed
const pending = ref<{ name: string; text: string }>();

const exportBackup = () => {
  // A data link instead of an object URL, which the lint compat rules reject
  const link = document.createElement("a");
  link.href = `data:application/json;charset=utf-8,${encodeURIComponent(
    workspace.exportBackup(),
  )}`;
  link.download = `breadcrumb-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
};

const chooseFile = () => {
  fileInput.value?.click();
};

const onFileChosen = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file === undefined) return;
  pending.value = { name: file.name, text: await file.text() };
};

const replace = () => {
  const file = pending.value;
  pending.value = undefined;
  if (file === undefined) return;
  const result = workspace.importBackup(file.text);
  if (result.kind === "error") {
    sdk.window.showToast(result.message, { variant: "error" });
    return;
  }
  sdk.window.showToast(
    `Imported ${result.templates} request(s) and ${result.sequences} sequence(s)`,
  );
};
</script>

<template>
  <div class="flex flex-col gap-4 p-4 max-w-xl">
    <section class="flex flex-col gap-2">
      <h2 class="text-sm font-semibold text-surface-200">Export</h2>
      <p class="text-xs text-surface-500">
        Saves this project's requests, collections, sequences and trees to a
        JSON file. The file does not depend on the Caido project, so it can be
        imported after a restore or a reinstall.
      </p>
      <div>
        <Button
          label="Export backup"
          icon="fas fa-download"
          @click="exportBackup"
        />
      </div>
    </section>

    <section class="flex flex-col gap-2">
      <h2 class="text-sm font-semibold text-surface-200">Import</h2>
      <p class="text-xs text-surface-500">
        Replaces this project's requests, collections, sequences and trees with
        the ones in a backup file. Export first if you want to keep the current
        data.
      </p>
      <input
        ref="fileInput"
        type="file"
        accept="application/json,.json"
        class="hidden"
        @change="onFileChosen"
      />
      <div v-if="pending === undefined">
        <Button
          label="Choose backup file"
          icon="fas fa-upload"
          severity="secondary"
          @click="chooseFile"
        />
      </div>
      <div v-else class="flex flex-col gap-2">
        <p class="text-sm text-surface-200">
          Replace this project's data with {{ pending.name }}?
        </p>
        <div class="flex gap-2">
          <Button label="Replace" severity="danger" @click="replace" />
          <Button
            label="Cancel"
            severity="secondary"
            @click="pending = undefined"
          />
        </div>
      </div>
    </section>
  </div>
</template>
