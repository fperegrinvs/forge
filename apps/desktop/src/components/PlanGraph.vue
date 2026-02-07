<template>
  <div style="height: 280px; border: 1px solid #ddd; border-radius: 8px; overflow: hidden">
    <VueFlow :nodes="nodes" :edges="edges" fit-view-on-init />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { VueFlow } from "@vue-flow/core";

type Task = {
  id: string;
  dependencies: string[];
};

const props = defineProps<{
  tasks: Task[];
}>();

const nodes = computed(() =>
  props.tasks.map((task, index) => ({
    id: task.id,
    position: { x: 80 + index * 170, y: 120 },
    data: { label: task.id }
  }))
);

const edges = computed(() =>
  props.tasks.flatMap((task) =>
    task.dependencies.map((dep) => ({
      id: `${dep}->${task.id}`,
      source: dep,
      target: task.id
    }))
  )
);
</script>
