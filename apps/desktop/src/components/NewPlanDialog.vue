<template>
  <v-dialog v-model="open" :width="dialogWidth" :height="dialogHeight" persistent class="new-plan-dialog">
    <v-card class="d-flex flex-column" style="height: 100%; overflow: hidden; resize: both;">
      <v-card-title class="d-flex align-center flex-shrink-0">
        <span>New Plan</span>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" @click="onClose" />
      </v-card-title>
      <v-card-text class="flex-grow-1 d-flex" style="overflow: hidden; min-height: 0;">
        <div class="d-flex flex-grow-1" style="min-height: 0;">
          <div v-if="showInstructions" class="instructions-panel pa-3" style="width: 280px; min-width: 280px; overflow-y: auto;">
            <h3 class="text-subtitle-1 mb-2">Instructions</h3>
            <ol class="text-body-2">
              <li class="mb-2">
                The terminal on the right is running <strong>{{ adapterLabel }}</strong>.
              </li>
              <li class="mb-2">
                {{ skillInstruction }} to start guided plan creation.
              </li>
              <li class="mb-2">
                Describe the feature you want to build when prompted.
              </li>
              <li class="mb-2">
                The agent will create a plan file in <code>plans/</code> inside your project.
              </li>
              <li class="mb-2">
                Click <strong>Done</strong> when finished.
              </li>
            </ol>

            <v-alert v-if="error" type="error" variant="tonal" class="mt-3">
              {{ error }}
            </v-alert>

            <v-alert v-if="!sessionId && !error" type="info" variant="tonal" class="mt-3">
              Starting terminal...
            </v-alert>

            <v-alert v-for="plan in newPlans" :key="plan.filename" :type="plan.valid === false ? 'error' : 'success'" variant="tonal" class="mt-3">
              <div class="d-flex align-center">
                <span>Plan detected: <strong>{{ plan.filename }}</strong></span>
                <v-chip
                  class="ml-2"
                  size="small"
                  :color="plan.validating ? 'grey' : plan.valid === true ? 'success' : plan.valid === false ? 'error' : 'grey'"
                  :prepend-icon="plan.validating ? 'mdi-loading mdi-spin' : plan.valid === true ? 'mdi-check-circle' : plan.valid === false ? 'mdi-close-circle' : 'mdi-help-circle'"
                  variant="tonal"
                >
                  {{ plan.validating ? 'Validating' : plan.valid === true ? 'Valid' : plan.valid === false ? 'Invalid' : 'Unknown' }}
                </v-chip>
              </div>
              <v-list v-if="plan.valid === false && plan.issues.length" density="compact" class="mt-2">
                <v-list-item
                  v-for="(issue, idx) in plan.issues"
                  :key="idx"
                  prepend-icon="mdi-alert-circle-outline"
                  :title="issue.message"
                  :subtitle="`${issue.path} (${issue.code})`"
                />
              </v-list>
            </v-alert>
          </div>

          <v-btn
            :icon="showInstructions ? 'mdi-chevron-left' : 'mdi-chevron-right'"
            variant="text"
            size="x-small"
            class="align-self-center flex-shrink-0"
            @click="showInstructions = !showInstructions"
          />

          <div class="flex-grow-1" style="min-width: 0; min-height: 0;">
            <TerminalPanel
              v-if="sessionId"
              :session-id="sessionId"
              @connected="onConnected"
              @disconnected="onDisconnected"
              @error="onTerminalError"
            />
            <div v-else-if="error" class="d-flex align-center justify-center" style="min-height: 300px">
              <v-icon icon="mdi-alert-circle-outline" size="48" color="error" />
            </div>
            <div v-else class="d-flex align-center justify-center" style="min-height: 300px">
              <v-progress-circular indeterminate />
            </div>
          </div>
        </div>
      </v-card-text>
      <v-card-actions class="flex-shrink-0">
        <v-spacer />
        <v-btn variant="text" @click="onClose">Cancel</v-btn>
        <v-btn v-if="newPlans.length" color="success" @click="onUsePlan(newPlans[0])">Use Plan</v-btn>
        <v-btn color="primary" @click="onDone">Done</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import TerminalPanel from "./TerminalPanel.vue";
import { terminalKill, terminalSpawn } from "../composables/useTerminal";
import { getSkillInvocation } from "./planDialogInstructions";

interface DiscoveredPlan {
  filename: string;
  path: string;
  valid: boolean | null;
  validating: boolean;
  taskStatuses: unknown[];
  issues: Array<{ path: string; message: string; code: string }>;
}

const props = defineProps<{
  projectRoot: string;
  adapter: string;
  discoveredPlans: DiscoveredPlan[];
}>();

const emit = defineEmits<{
  planCreated: [planPath?: string];
}>();

const open = defineModel<boolean>({ default: false });

const skillInstruction = computed(() => getSkillInvocation(props.adapter));
const adapterLabel = computed(() => {
  if (props.adapter === "claude") return "Claude Code";
  if (props.adapter === "codex") return "Codex";
  return props.adapter;
});

const showInstructions = ref(true);
const dialogWidth = ref(1000);
const dialogHeight = ref(600);
const sessionId = ref<string>("");
const error = ref<string>("");
const initialPlanFilenames = ref<Set<string>>(new Set());

const newPlans = computed(() =>
  props.discoveredPlans.filter((p) => !initialPlanFilenames.value.has(p.filename))
);

watch(open, async (value) => {
  if (value) {
    initialPlanFilenames.value = new Set(props.discoveredPlans.map((p) => p.filename));
    error.value = "";
    sessionId.value = "";
    try {
      const result = await terminalSpawn({
        command: props.adapter,
        cwd: props.projectRoot
      });
      sessionId.value = result.sessionId;
    } catch (e) {
      error.value = `Failed to start terminal: ${String(e)}`;
    }
  } else {
    await killSession();
  }
});

async function killSession(): Promise<void> {
  if (sessionId.value) {
    try {
      await terminalKill(sessionId.value);
    } catch {
      // Best effort cleanup
    }
    sessionId.value = "";
  }
}

function onConnected(): void {
  // Terminal WebSocket connected
}

function onDisconnected(): void {
  // Terminal WebSocket disconnected
}

function onTerminalError(message: string): void {
  error.value = message;
}

function onClose(): void {
  open.value = false;
}

function onDone(): void {
  emit("planCreated");
  open.value = false;
}

function onUsePlan(plan: DiscoveredPlan): void {
  emit("planCreated", plan.path);
  open.value = false;
}
</script>

<style scoped>
.new-plan-dialog :deep(.v-overlay__content) {
  max-width: 90vw;
  max-height: 90vh;
}

.instructions-panel {
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
