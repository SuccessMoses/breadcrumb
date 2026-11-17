<script setup lang="ts">
import Tab from "primevue/tab";
import TabList from "primevue/tablist";
import TabPanel from "primevue/tabpanel";
import TabPanels from "primevue/tabpanels";
import Tabs from "primevue/tabs";
import { ref } from "vue";

import { Requests } from "./Requests";
import { Sequences } from "./Sequences";
import { Tree } from "./Tree";

import { useSDK } from "@/plugins/sdk";
import { createWorkspace } from "@/workspace/workspace";

const sdk = useSDK();
const workspace = createWorkspace(sdk);
const activeTab = ref("requests");

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
  <Tabs v-model:value="activeTab" class="h-full flex flex-col">
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
