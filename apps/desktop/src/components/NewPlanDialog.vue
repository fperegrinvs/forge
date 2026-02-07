<template>
  <v-dialog v-model="open" max-width="1000" persistent>
    <v-card>
      <v-card-title class="d-flex align-center">
        <span>New Plan</span>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" @click="onClose" />
      </v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="4">
            <h3 class="text-subtitle-1 mb-2">Instructions</h3>
            <ol class="text-body-2">
              <li class="mb-2">
                The terminal on the right is running <strong>{{ adapter }}</strong>.
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
          </v-col>
          <v-col cols="8">
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
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="onClose">Cancel</v-btn>
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

const props = defineProps<{
  projectRoot: string;
  adapter: string;
}>();

const emit = defineEmits<{
  planCreated: [];
}>();

const open = defineModel<boolean>({ default: false });

const skillInstruction = computed(() => getSkillInvocation(props.adapter));

const sessionId = ref<string>("");
const error = ref<string>("");

watch(open, async (value) => {
  if (value) {
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
</script>
