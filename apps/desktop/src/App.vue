<template>
  <v-app>
    <v-main>
      <v-container class="py-6">
        <h1 class="text-h4 mb-4">Forge Orchestrator</h1>

        <v-row>
          <v-col cols="12" md="8">
            <v-card class="pa-4 mb-4">
              <v-text-field v-model="planPath" label="Plan path" density="comfortable" />
              <v-select v-model="adapter" :items="['codex', 'claude']" label="Adapter" density="comfortable" />

              <div class="d-flex flex-wrap ga-2">
                <v-btn color="primary" @click="onValidate">Validate Plan</v-btn>
                <v-btn color="primary" variant="outlined" @click="onRunNext">Run Next</v-btn>
                <v-btn color="warning" variant="outlined" @click="onPause">Pause</v-btn>
                <v-btn color="success" variant="outlined" @click="onResume">Resume</v-btn>
                <v-btn color="secondary" variant="outlined" @click="onOpenEvidence">Open Evidence</v-btn>
                <v-btn color="secondary" variant="tonal" @click="onRevise">Revise Plan</v-btn>
              </div>
            </v-card>

            <v-card class="pa-4 mb-4">
              <h2 class="text-h6 mb-2">DAG</h2>
              <PlanGraph :tasks="tasks" />
            </v-card>

            <v-card class="pa-4">
              <h2 class="text-h6 mb-2">Execution Log</h2>
              <v-list density="compact">
                <v-list-item v-for="(entry, index) in logs" :key="index" :title="entry" />
              </v-list>
            </v-card>
          </v-col>

          <v-col cols="12" md="4">
            <v-card class="pa-4 mb-4">
              <h2 class="text-h6 mb-2">Current Task</h2>
              <p><strong>ID:</strong> {{ current.taskId || '-' }}</p>
              <p><strong>Status:</strong> {{ current.state || '-' }}</p>
              <p><strong>Message:</strong> {{ current.message || '-' }}</p>
            </v-card>

            <v-card class="pa-4 mb-4">
              <h2 class="text-h6 mb-2">Gate Results</h2>
              <p>{{ validationSummary }}</p>
            </v-card>

            <v-card class="pa-4">
              <h2 class="text-h6 mb-2">Evidence</h2>
              <v-list density="compact">
                <v-list-item v-for="(entry, index) in evidence" :key="index" :title="entry" />
              </v-list>
            </v-card>
          </v-col>
        </v-row>
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import PlanGraph from "./components/PlanGraph.vue";
import { getEvidence, pauseRun, planValidate, resumeRun, runNext, type RunNextResult } from "./composables/useControlPlane";

const adapter = ref<"codex" | "claude">("codex");
const planPath = ref("./plan.json");
const runId = ref("run-manual");
const validationSummary = ref("No validation run yet");
const logs = ref<string[]>([]);
const evidence = ref<string[]>([]);

const current = reactive<RunNextResult>({
  state: "idle",
  message: "Not started"
});

const tasks = ref([
  { id: "task-1", dependencies: [] },
  { id: "task-2", dependencies: ["task-1"] }
]);

async function onValidate(): Promise<void> {
  const result = await planValidate(planPath.value);
  validationSummary.value = result.valid ? "Plan valid" : `Plan invalid (${result.issues.length} issues)`;
  logs.value.unshift(`Validate Plan -> ${validationSummary.value}`);
}

async function onRunNext(): Promise<void> {
  const result = await runNext(planPath.value, adapter.value);
  current.state = result.state;
  current.taskId = result.taskId;
  current.message = result.message;
  logs.value.unshift(`Run Next -> ${result.message}`);
}

async function onPause(): Promise<void> {
  const ok = await pauseRun(runId.value);
  logs.value.unshift(`Pause -> ${ok ? "ok" : "failed"}`);
}

async function onResume(): Promise<void> {
  const ok = await resumeRun(runId.value);
  logs.value.unshift(`Resume -> ${ok ? "ok" : "failed"}`);
}

async function onOpenEvidence(): Promise<void> {
  if (!current.taskId) {
    logs.value.unshift("Open Evidence -> no task selected");
    return;
  }

  evidence.value = await getEvidence(current.taskId);
  logs.value.unshift(`Open Evidence -> ${evidence.value.length} entries`);
}

function onRevise(): void {
  logs.value.unshift("Revise Plan -> handoff to planning loop");
}
</script>
