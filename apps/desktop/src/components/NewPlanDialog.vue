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
                The panel on the right is running <strong>{{ adapterLabel }}</strong>.
              </li>
              <li class="mb-2">
                {{ skillInstruction }} to start guided plan creation.
              </li>
              <li class="mb-2">
                Describe the feature you want to build when prompted.
              </li>
              <li class="mb-2">
                The agent will create or update a plan file in <code>plans/</code> inside your project.
              </li>
              <li class="mb-2">
                Click <strong>Done</strong> when finished.
              </li>
            </ol>

            <v-alert v-if="error" type="error" variant="tonal" class="mt-3">
              {{ error }}
            </v-alert>

            <v-alert v-if="starting && !error" type="info" variant="tonal" class="mt-3">
              {{ isCodex ? "Starting Codex session..." : "Starting terminal..." }}
            </v-alert>

            <v-alert v-for="plan in changedPlans" :key="plan.filename" :type="plan.valid === false ? 'error' : 'success'" variant="tonal" class="mt-3">
              <div class="d-flex align-center">
                <span>
                  {{ plan.kind === "updated" ? "Plan updated" : "Plan detected" }}:
                  <strong>{{ plan.filename }}</strong>
                </span>
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
            <v-alert v-if="error" type="error" variant="tonal" class="mb-2">
              {{ error }}
            </v-alert>
            <template v-if="isCodex">
              <div v-if="!codexStreamId && !error" class="d-flex align-center justify-center" style="min-height: 300px">
                <v-progress-circular indeterminate />
              </div>
              <div v-else style="height: 100%; min-height: 0; display: flex; flex-direction: column;">
                <LiveOutputPane :segments="codexLiveOutput" :tick="codexLiveOutputTick" @clear="clearCodexLiveOutput" />
                <div class="d-flex flex-wrap ga-2 align-center mt-3">
                  <v-text-field
                    v-model="codexInput"
                    label="Send message"
                    density="comfortable"
                    :disabled="!codexStreamId"
                    hide-details
                    @keyup.enter="onCodexSend"
                  />
                  <v-btn color="primary" variant="outlined" :disabled="!codexStreamId || !codexInput.trim()" @click="onCodexSend">
                    Send
                  </v-btn>
                  <v-btn color="secondary" variant="outlined" :disabled="!codexStreamId" @click="onCodexCancel">
                    Cancel
                  </v-btn>
                </div>
              </div>
            </template>
            <template v-else>
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
            </template>
          </div>
        </div>
      </v-card-text>
      <v-card-actions class="flex-shrink-0">
        <v-spacer />
        <v-btn variant="text" @click="onClose">Cancel</v-btn>
        <v-btn v-if="changedPlans.length" color="success" @click="onUsePlan(changedPlans[0])">Use Plan</v-btn>
        <v-btn color="primary" @click="onDone">Done</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="userInputOpen" max-width="700">
    <v-card class="pa-4">
      <h2 class="text-h6 mb-3">Codex Needs Input</h2>
      <div v-for="q in userInputQuestions" :key="q.id" class="mb-4">
        <div v-if="q.header" class="text-subtitle-2 mb-1">{{ q.header }}</div>
        <div class="text-body-2 mb-2">{{ q.question }}</div>
        <v-radio-group v-model="userInputSelectedByQuestionId[q.id]" density="comfortable" hide-details>
          <v-radio
            v-for="opt in q.options"
            :key="opt.label"
            :label="opt.description ? `${opt.label} - ${opt.description}` : opt.label"
            :value="opt.label"
          />
        </v-radio-group>
        <v-text-field
          v-if="q.options.find((o) => o.label === userInputSelectedByQuestionId[q.id])?.isOther"
          v-model="userInputOtherTextByQuestionId[q.id]"
          label="Other"
          density="comfortable"
        />
      </div>
      <div class="d-flex ga-2 justify-end">
        <v-btn variant="text" @click="cancelUserInput">Cancel</v-btn>
        <v-btn color="primary" @click="submitUserInput">Submit</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import LiveOutputPane from "./LiveOutputPane.vue";
import TerminalPanel from "./TerminalPanel.vue";
import { terminalKill, terminalSpawn } from "../composables/useTerminal";
import { codexSessionCancel, codexSessionPromptRespond, codexSessionSend, codexSessionStreamUrl } from "../composables/useControlPlane";
import { getSkillInvocation } from "./planDialogInstructions";
import { buildNewPlanSpawnConfig } from "./newPlanSpawnConfig";
import { computeChangedPlans, type DiscoveredPlan } from "../lib/plans.js";

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
const isCodex = computed(() => props.adapter === "codex");

const showInstructions = ref(true);
const dialogWidth = ref(1000);
const dialogHeight = ref(600);
const sessionId = ref<string>("");
const codexStreamId = ref<string>("");
const codexInput = ref<string>("");
let codexEventSource: EventSource | null = null;
const error = ref<string>("");
const initialBaselineByFilename = ref<Map<string, number>>(new Map());

const changedPlans = computed(() => computeChangedPlans(props.discoveredPlans, initialBaselineByFilename.value));
const starting = computed(() => {
  if (error.value) return false;
  if (isCodex.value) return !codexStreamId.value;
  return !sessionId.value;
});

type LiveOutputSegment = {
  stream: "stdout" | "stderr" | "system";
  text: string;
};

const codexLiveOutput = ref<LiveOutputSegment[]>([]);
const codexLiveOutputTick = ref(0);

function clearCodexLiveOutput(): void {
  codexLiveOutput.value = [];
  codexLiveOutputTick.value++;
}

function appendCodexLiveOutput(stream: LiveOutputSegment["stream"], text: string): void {
  if (!text) return;
  const segments = codexLiveOutput.value;
  const last = segments.length > 0 ? segments[segments.length - 1] : undefined;
  if (last && last.stream === stream) {
    last.text += text;
  } else {
    segments.push({ stream, text });
  }
  if (segments.length > 2000) {
    segments.splice(0, segments.length - 2000);
  }
  codexLiveOutputTick.value++;
}

type UserInputOption = { label: string; description?: string; isOther?: boolean };
type UserInputQuestion = { id: string; header?: string; question: string; options: UserInputOption[] };

const userInputOpen = ref(false);
const userInputRequestId = ref("");
const userInputQuestions = ref<UserInputQuestion[]>([]);
const userInputSelectedByQuestionId = ref<Record<string, string>>({});
const userInputOtherTextByQuestionId = ref<Record<string, string>>({});

function openUserInput(requestId: string, questions: UserInputQuestion[]): void {
  userInputRequestId.value = requestId;
  userInputQuestions.value = questions;
  userInputSelectedByQuestionId.value = {};
  userInputOtherTextByQuestionId.value = {};
  for (const q of questions) {
    const first = q.options[0]?.label ?? "";
    if (first) userInputSelectedByQuestionId.value[q.id] = first;
  }
  userInputOpen.value = true;
}

function closeUserInput(): void {
  userInputOpen.value = false;
  userInputRequestId.value = "";
  userInputQuestions.value = [];
  userInputSelectedByQuestionId.value = {};
  userInputOtherTextByQuestionId.value = {};
}

async function cancelUserInput(): Promise<void> {
  closeUserInput();
  await onCodexCancel();
}

async function submitUserInput(): Promise<void> {
  if (!codexStreamId.value || !userInputRequestId.value) return;
  const answers: Record<string, { answers: string[] }> = {};
  for (const q of userInputQuestions.value) {
    const selected = userInputSelectedByQuestionId.value[q.id] ?? "";
    const option = q.options.find((o) => o.label === selected);
    const value =
      option?.isOther === true ? (userInputOtherTextByQuestionId.value[q.id] ?? "").trim() || selected : selected;
    answers[q.id] = { answers: value ? [value] : [] };
  }
  await codexSessionPromptRespond(codexStreamId.value, userInputRequestId.value, answers);
  appendCodexLiveOutput("system", `[prompt] responded to ${userInputRequestId.value}\n`);
  closeUserInput();
}

watch(open, async (value) => {
  if (value) {
    initialBaselineByFilename.value = new Map(props.discoveredPlans.map((p) => [p.filename, p.modifiedMs]));
    error.value = "";
    sessionId.value = "";
    codexStreamId.value = "";
    clearCodexLiveOutput();
    try {
      if (isCodex.value) {
        await startCodexSession();
      } else {
        const spawnConfig = buildNewPlanSpawnConfig(props.adapter, props.projectRoot);
        const result = await terminalSpawn(spawnConfig);
        sessionId.value = result.sessionId;
      }
    } catch (e) {
      error.value = `Failed to start session: ${String(e)}`;
    }
  } else {
    await killSession();
  }
});

async function killSession(): Promise<void> {
  closeUserInput();
  if (codexEventSource) {
    codexEventSource.close();
    codexEventSource = null;
  }
  if (codexStreamId.value) {
    try {
      await codexSessionCancel(codexStreamId.value);
    } catch {
      // best effort
    }
    codexStreamId.value = "";
  }
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

async function startCodexSession(): Promise<void> {
  if (codexEventSource) {
    codexEventSource.close();
    codexEventSource = null;
  }

  const url = codexSessionStreamUrl(props.projectRoot);
  codexEventSource = new EventSource(url);
  codexEventSource.addEventListener("message", (event) => {
    const raw = (event as MessageEvent).data as string;
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      appendCodexLiveOutput("system", raw.endsWith("\n") ? raw : `${raw}\n`);
      return;
    }

    const type = String(parsed?.type ?? "");
    if (type === "sse.meta") {
      codexStreamId.value = String(parsed.streamId ?? "");
      return;
    }
    if (type === "process.stderr") {
      appendCodexLiveOutput("system", `[forge stderr] ${String(parsed.line ?? "")}\n`);
      return;
    }
    if (type === "adapter.event") {
      const e = parsed.event;
      if (e?.type === "run.output") {
        const stream = String(e.stream ?? "stdout");
        const chunk = String(e.chunk ?? "");
        appendCodexLiveOutput(stream === "stderr" ? "stderr" : "stdout", chunk);
      } else if (e?.type === "run.user_input.requested") {
        openUserInput(String(e.requestId ?? ""), (e.questions ?? []) as UserInputQuestion[]);
        appendCodexLiveOutput("system", `[prompt] waiting for user input (${String(e.requestId ?? "")})\n`);
      } else if (e?.type === "run.failed") {
        appendCodexLiveOutput("stderr", `[failed] ${String(e.reason ?? "")}\n`);
      }
      return;
    }

    appendCodexLiveOutput("system", type ? `[${type}] ${raw}\n` : `${raw}\n`);
  });
  codexEventSource.addEventListener("error", () => {
    appendCodexLiveOutput("system", "[error] session disconnected\n");
  });
}

async function onCodexSend(): Promise<void> {
  const text = codexInput.value.trim();
  if (!text || !codexStreamId.value) return;
  await codexSessionSend(codexStreamId.value, text);
  codexInput.value = "";
}

async function onCodexCancel(): Promise<void> {
  if (!codexStreamId.value) return;
  await codexSessionCancel(codexStreamId.value);
  if (codexEventSource) {
    codexEventSource.close();
    codexEventSource = null;
  }
  codexStreamId.value = "";
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
