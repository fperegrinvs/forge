<template>
  <div class="pack-workflow-graph">
    <VueFlow
      :nodes="nodes"
      :edges="edges"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="false"
      :zoom-on-scroll="false"
      :zoom-on-pinch="false"
      :pan-on-drag="true"
      fit-view-on-init
      @node-click="onNodeClick"
    >
      <template #node-default="{ data }">
        <div class="node" :class="`status-${data.status}`">
          <div class="phase">{{ data.title }}</div>
          <div class="gate">gate: {{ data.gate }}</div>
        </div>
      </template>
    </VueFlow>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { VueFlow } from "@vue-flow/core";
import type { PhaseGateBindings, WorkflowPhase } from "../composables/useControlPlane";
import { buildWorkflowGraph } from "../lib/workflowGraph";

const props = defineProps<{
  phases: WorkflowPhase[];
  bindings: PhaseGateBindings;
  defaultPhaseGateBindings: Record<string, string>;
}>();

const emit = defineEmits<{ (e: "phase-click", phaseId: string): void }>();

const graph = computed(() => buildWorkflowGraph(props.phases, props.bindings, props.defaultPhaseGateBindings));
const nodes = computed(() => graph.value.nodes);
const edges = computed(() => graph.value.edges);

function onNodeClick(event: { node: { id: string } }): void {
  emit("phase-click", event.node.id);
}
</script>

<style scoped>
.pack-workflow-graph {
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 10px;
  overflow: hidden;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.02), rgba(0, 0, 0, 0));
  height: 220px;
}

.node {
  min-width: 180px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: #fff;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.06);
  cursor: pointer;
}

.phase {
  font-weight: 700;
  letter-spacing: 0.2px;
  text-transform: none;
}

.gate {
  margin-top: 2px;
  font-size: 12px;
  opacity: 0.75;
}

.status-default {
  border-color: rgba(25, 118, 210, 0.35);
  background: linear-gradient(180deg, rgba(25, 118, 210, 0.06), #fff);
}

.status-custom {
  border-color: rgba(46, 125, 50, 0.38);
  background: linear-gradient(180deg, rgba(46, 125, 50, 0.08), #fff);
}

.status-disabled {
  opacity: 0.55;
}

.status-unbound {
  border-style: dashed;
}
</style>
