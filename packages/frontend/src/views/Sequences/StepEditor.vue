<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";

import { createHttpEditor, type HttpEditor } from "@/editor/httpEditor";

// One request or response in a sequence's continuous view. The editor sizes to
// its text; the parent decides whether the text is read-only.
const { text, readOnly } = defineProps<{ text: string; readOnly: boolean }>();

const host = ref<HTMLElement>();
let editor: HttpEditor | undefined;

onMounted(() => {
  if (host.value === undefined) return;
  editor = createHttpEditor(host.value, readOnly, true);
  editor.setText(text);
});

onUnmounted(() => {
  editor?.destroy();
  editor = undefined;
});

// Rerendering or sending changes the text from outside, so show it
watch(
  () => text,
  (latest) => {
    // The editor works in LF; stored text is CRLF
    if (
      editor !== undefined &&
      editor.getText() !== latest.replace(/\r\n/g, "\n")
    ) {
      editor.setText(latest);
    }
  },
);

// The text as it is in the editor, for saving edits
defineExpose({ getText: () => editor?.getText() ?? text });
</script>

<template>
  <div ref="host" class="min-w-0" />
</template>
