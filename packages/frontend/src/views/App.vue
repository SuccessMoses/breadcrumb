<script setup lang="ts">
import Tab from "primevue/tab";
import TabList from "primevue/tablist";
import TabPanel from "primevue/tabpanel";
import TabPanels from "primevue/tabpanels";
import Tabs from "primevue/tabs";
import { onMounted, onUnmounted, ref, shallowRef } from "vue";

import { Requests } from "./Requests";
import { Sequences } from "./Sequences";
import { Tree } from "./Tree";

import { useSDK } from "@/plugins/sdk";
import { createWorkspace, type Workspace } from "@/workspace/workspace";

const sdk = useSDK();
// Each Caido project gets its own workspace; it is rebuilt when the project changes
const projectId = ref<string>();
const workspace = shallowRef<Workspace>();
const activeTab = ref("requests");

const openProject = (id: string | undefined) => {
  projectId.value = id;
  workspace.value = id === undefined ? undefined : createWorkspace(sdk, id);
};

const projectListener = sdk.projects.onCurrentProjectChange((event) =>
  openProject(event.projectId),
);

onMounted(async () => {
  const result = await sdk.backend.currentProjectId();
  openProject(result.kind === "Ok" ? result.value : undefined);
});

onUnmounted(() => projectListener.stop());

// Opening a sequence from the Tree jumps to its view
const showSequence = () => {
  activeTab.value = "sequences";
};

// Opening a step from a sequence jumps to its request template
const showTemplate = () => {
  activeTab.value = "requests";
};
</script>

<template>
  <div v-if="workspace === undefined" class="p-6 text-surface-400">
    Open a Caido project to use Breadcrumb.
  </div>
  <Tabs
    v-else
    :key="projectId"
    v-model:value="activeTab"
    class="h-full flex flex-col"
  >
    <TabList>
      <Tab value="requests">Requests</Tab>
      <Tab value="sequences">Sequences</Tab>
      <Tab value="tree">Tree</Tab>
    </TabList>
    <TabPanels class="flex-1 min-h-0 p-0">
      <TabPanel value="requests" class="h-full"
        ><Requests :workspace="workspace"
      /></TabPanel>
      <TabPanel value="sequences" class="h-full"
        ><Sequences :workspace="workspace" @open-template="showTemplate"
      /></TabPanel>
      <TabPanel value="tree" class="h-full"
        ><Tree :workspace="workspace" @open-sequence="showSequence"
      /></TabPanel>
    </TabPanels>
  </Tabs>
</template>
