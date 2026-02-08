<template>
  <v-app>
    <v-main>
      <v-container class="py-6">
        <div class="d-flex align-center mb-4">
          <h1 class="text-h4">Forge Desktop</h1>
          <v-spacer />
          <v-btn color="primary" prepend-icon="mdi-plus" @click="showCreateProject = true">
            New Project
          </v-btn>
        </div>

        <CreateProjectDialog v-model="showCreateProject" @created="onProjectCreated" />
        <NewPlanDialog v-model="showNewPlan" :project-root="projectRoot" :adapter="adapter" :discovered-plans="discoveredPlans" @plan-created="onPlanCreated" />

        <v-tabs v-model="tab" class="mb-4">
          <v-tab value="orchestrate">Orchestrate</v-tab>
          <v-tab value="packs">Packs</v-tab>
        </v-tabs>

        <v-window v-model="tab">
          <v-window-item value="orchestrate">
            <v-row>
              <v-col cols="12" md="8">
                <v-card class="pa-4 mb-4">
                  <v-text-field v-model="projectRoot" label="Project root" density="comfortable" readonly @click="onBrowseProjectRoot">
                    <template #append>
                      <v-btn size="small" variant="text" @click.stop="onBrowseProjectRoot">Browse</v-btn>
                    </template>
                  </v-text-field>

                  <v-alert v-if="!guidanceStatus?.installed" type="info" variant="tonal" class="mb-3">
                    <div class="d-flex flex-wrap align-center ga-2">
                      <span>No pack is installed in this project yet. Install one from the Packs tab to enable rules and skills.</span>
                      <v-btn size="small" variant="text" @click="tab = 'packs'">Open Packs</v-btn>
                    </div>
                  </v-alert>

                  <v-text-field v-model="planPath" label="Plan path (relative to project root)" density="comfortable" />

                  <div v-if="discoveredPlans.length" class="mb-3">
                    <div class="text-subtitle-2 mb-1">Discovered Plans</div>
                    <v-chip-group>
                      <v-chip
                        v-for="plan in discoveredPlans"
                        :key="plan.filename"
                        :color="plan.validating ? 'grey' : plan.valid === true ? 'success' : plan.valid === false ? 'error' : 'grey'"
                        :prepend-icon="plan.validating ? 'mdi-loading mdi-spin' : plan.valid === true ? 'mdi-check-circle' : plan.valid === false ? 'mdi-close-circle' : 'mdi-help-circle'"
                        variant="tonal"
                        @click="onSelectPlan(plan)"
                      >
                        {{ plan.filename }}
                      </v-chip>
                    </v-chip-group>
                  </div>

                  <v-select v-model="adapter" :items="adapterOptions" item-title="title" item-value="value" label="Adapter" density="comfortable" />

                  <div class="d-flex flex-wrap ga-2">
                    <v-btn color="primary" variant="outlined" prepend-icon="mdi-file-document-plus-outline" @click="showNewPlan = true">New Plan</v-btn>
                    <v-btn color="primary" variant="outlined" @click="onRunNextStream">Run</v-btn>
                    <v-btn color="secondary" variant="outlined" @click="onOpenEvidence">Open Evidence</v-btn>
                  </div>

                  <div class="d-flex flex-wrap ga-2 align-center mt-3">
                    <v-text-field
                      v-model="streamInput"
                      label="Send input to LLM (stream mode)"
                      density="comfortable"
                      :disabled="!streaming || !streamId"
                      hide-details
                      @keyup.enter="onSendStreamInput"
                    />
                    <v-btn
                      color="primary"
                      variant="outlined"
                      :disabled="!streaming || !streamId || !streamInput.trim()"
                      @click="onSendStreamInput"
                    >
                      Send
                    </v-btn>
                    <v-btn color="secondary" variant="outlined" :disabled="!streaming || !streamId" @click="onCancelStream">
                      Cancel
                    </v-btn>
                  </div>
                </v-card>

                <LiveOutputPane :segments="liveOutput" :tick="liveOutputTick" @clear="clearLiveOutput" />

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
                  <p><strong>ID:</strong> {{ current.taskId || "-" }}</p>
                  <p><strong>Status:</strong> {{ current.state || "-" }}</p>
                  <p><strong>Run ID:</strong> {{ current.runId || "-" }}</p>
                  <p><strong>External Run ID:</strong> {{ current.externalRunId || "-" }}</p>
                  <p><strong>Resume:</strong> {{ current.resumeCommand || "-" }}</p>
                  <p><strong>Stream ID:</strong> {{ streamId || "-" }}</p>
                  <p><strong>Message:</strong> {{ current.message || "-" }}</p>
                </v-card>

                <v-card v-if="selectedPlanStatuses.length" class="pa-4 mb-4">
                  <h2 class="text-h6 mb-2">Task Status</h2>
                  <v-list density="compact">
                    <v-list-item
                      v-for="ts in selectedPlanStatuses"
                      :key="ts.id"
                      :prepend-icon="ts.state === 'completed' ? 'mdi-check-circle' : ts.state === 'running' ? 'mdi-play-circle' : ts.state === 'failed' ? 'mdi-alert-circle' : ts.state === 'paused' ? 'mdi-pause-circle' : 'mdi-clock-outline'"
                      :title="ts.id"
                      :subtitle="ts.state"
                    />
                  </v-list>
                </v-card>

                <v-card class="pa-4 mb-4">
                  <h2 class="text-h6 mb-2">Gate Results</h2>
                  <p>{{ validationSummary }}</p>
                  <v-list v-if="selectedPlanIssues.length" density="compact" class="mt-2">
                    <v-list-item
                      v-for="(issue, index) in selectedPlanIssues"
                      :key="index"
                      prepend-icon="mdi-alert-circle-outline"
                      :title="issue.message"
                      :subtitle="`${issue.path} (${issue.code})`"
                    />
                  </v-list>
                </v-card>

                <v-card class="pa-4">
                  <h2 class="text-h6 mb-2">Evidence</h2>
                  <v-list density="compact">
                    <v-list-item v-for="(entry, index) in evidence" :key="index" :title="entry" />
                  </v-list>
                </v-card>
              </v-col>
            </v-row>
          </v-window-item>

          <v-window-item value="packs">
            <v-row>
              <v-col cols="12" md="7">
                <v-card class="pa-4 mb-4">
                  <h2 class="text-h6 mb-3">Project Pack</h2>
                  <v-text-field v-model="projectRoot" label="Project root" density="comfortable" readonly @click="onBrowseProjectRoot">
                    <template #append>
                      <v-btn size="small" variant="text" @click.stop="onBrowseProjectRoot">Browse</v-btn>
                    </template>
                  </v-text-field>

                  <div class="d-flex flex-wrap ga-2 mb-3">
                    <v-btn color="primary" variant="outlined" @click="onRefreshGuidance">Refresh Status</v-btn>
                    <v-btn color="primary" variant="outlined" @click="onCheckUpdates">Check Updates</v-btn>
                  </div>

                  <v-alert v-if="!guidanceStatus?.installed" type="info" variant="tonal" class="mb-3">
                    No pack is installed in this project yet. Select a pack below and install it to enable rules and skills.
                  </v-alert>

                  <v-alert v-if="switchingPackName" type="warning" variant="tonal" class="mb-3">
                    Switching packs may leave mixed configuration unless you use Force replace.
                  </v-alert>

                  <v-alert v-if="guidanceError" type="error" variant="tonal" class="mb-3">
                    {{ guidanceError }}
                  </v-alert>

                  <p class="mb-1">
                    <strong>Installed:</strong>
                    <span v-if="guidanceStatus?.installed">
                      {{ guidanceStatus.manifest?.name || "guidance" }} @ {{ guidanceStatus.manifest?.version || "?" }}
                    </span>
                    <span v-else>no</span>
                  </p>

                  <p v-if="installedProjectPackSource" class="mb-1 text-body-2">
                    <strong>Source:</strong>
                    {{ installedProjectPackSource.pack.path }} ({{ installedProjectPackSource.pack.name }} @ {{ installedProjectPackSource.pack.version }})
                  </p>

                  <p class="mb-3">
                    <strong>Latest (remote):</strong>
                    <span>{{ selectedPackLatestVersion || "-" }}</span>
                  </p>

                  <v-select
                    v-model="selectedPackName"
                    :items="availablePackNames"
                    label="Pack"
                    density="comfortable"
                    class="mb-2"
                  />

                  <v-select
                    v-model="selectedPackPath"
                    :items="downloadedVersionsForSelected"
                    item-title="version"
                    item-value="path"
                    label="Downloaded version"
                    density="comfortable"
                    :disabled="!downloadedVersionsForSelected.length"
                  >
                    <template #selection="{ item }">
                      <span>{{ item?.title }}</span>
                    </template>
                    <template #item="{ props, item }">
                      <v-list-item v-bind="props" :title="item?.title" :subtitle="String(item?.raw?.path ?? '')" />
                    </template>
                  </v-select>

                  <div class="d-flex flex-wrap ga-2 align-center">
                    <v-btn color="primary" :disabled="!selectedPackLatestVersion" @click="onDownloadLatestGuidance">
                      Download Latest
                    </v-btn>
                    <v-btn
                      color="primary"
                      variant="outlined"
                      :disabled="!selectedPackPath"
                      @click="onInstallGuidance"
                    >
                      Install/Update In Project
                    </v-btn>
                    <v-checkbox v-model="forceReplace" label="Force replace local changes" density="compact" hide-details />
                  </div>

                  <p v-if="selectedDownloadedPack" class="mt-3 text-body-2">
                    <strong>Selected:</strong> {{ selectedDownloadedPack.name }} @ {{ selectedDownloadedPack.version }}
                    <br />
                    <strong>Path:</strong> {{ selectedDownloadedPack.path }}
                  </p>
                </v-card>
              </v-col>

              <v-col cols="12" md="5">
                <v-card class="pa-4 mb-4">
                  <h2 class="text-h6 mb-2">Installed Packs</h2>
                  <div class="d-flex flex-wrap ga-2 mb-3">
                    <v-btn color="secondary" variant="outlined" @click="onListInstalledPacks">Refresh</v-btn>
                  </div>
                  <v-list density="compact">
                    <v-list-item
                      v-for="(p, index) in installedPacks"
                      :key="index"
                      :title="`${p.name} @ ${p.version}`"
                      :subtitle="p.path"
                      @click="onSelectInstalledPack(p)"
                    />
                  </v-list>
                </v-card>

                <v-card class="pa-4">
                  <h2 class="text-h6 mb-2">Packs Log</h2>
                  <v-list density="compact">
                    <v-list-item v-for="(entry, index) in packLogs" :key="index" :title="entry" />
                  </v-list>
                </v-card>
              </v-col>
            </v-row>
          </v-window-item>
        </v-window>
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import CreateProjectDialog from "./components/CreateProjectDialog.vue";
import NewPlanDialog from "./components/NewPlanDialog.vue";
import LiveOutputPane from "./components/LiveOutputPane.vue";
import { mergeDiscoveredPlans } from "./lib/mergeDiscoveredPlans.js";
import {
  getCwd,
  getEvidence,
  packsCheckUpdates,
  packsDownload,
  packsListInstalled,
  planValidate,
  plansList,
  plansStatus,
  projectGetGuidanceStatus,
  projectInstallGuidance,
  runNextStreamCancel,
  runNextStreamInput,
  runNextStreamUrl,
  selectFolder,
  type InstalledPack,
  type PackUpdateStatus,
  type PlanFileEntry,
  type ProjectGuidanceStatus,
  type RunNextResult,
  type TaskStatus,
  type ValidationIssue
} from "./composables/useControlPlane";

const tab = ref<"orchestrate" | "packs">("orchestrate");
const showCreateProject = ref(false);
const showNewPlan = ref(false);
const adapter = ref<"codex" | "claude">("codex");
const adapterOptions = [
  { title: "Codex", value: "codex" as const },
  { title: "Claude Code", value: "claude" as const }
];
const projectRoot = ref(".");
const planPath = ref("./plan.json");
const logs = ref<string[]>([]);
const evidence = ref<string[]>([]);

const LAST_PROJECT_ROOT_KEY = "forge.desktop.lastProjectRoot";

const guidanceStatus = ref<ProjectGuidanceStatus>();
const guidanceError = ref<string>("");
const packUpdates = ref<PackUpdateStatus[]>([]);
const selectedPackName = ref<string>("forge-guidance-pack");
const selectedPackPath = ref<string>("");
const forceReplace = ref(false);
const installedPacks = ref<InstalledPack[]>([]);
const packLogs = ref<string[]>([]);

function parseSemver(value: string): [number, number, number] | null {
  const core = value.split("-")[0]?.split("+")[0] ?? "";
  const parts = core.split(".");
  if (parts.length < 3) return null;
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  const patch = Number(parts[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return null;
  return [major, minor, patch];
}

function compareVersionDesc(a: string, b: string): number {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  if (av && bv) {
    if (av[0] !== bv[0]) return bv[0] - av[0];
    if (av[1] !== bv[1]) return bv[1] - av[1];
    if (av[2] !== bv[2]) return bv[2] - av[2];
    return 0;
  }
  return b.localeCompare(a);
}

const availablePackNames = computed(() => {
  const names = new Set<string>();
  for (const p of installedPacks.value) names.add(p.name);
  for (const u of packUpdates.value) names.add(u.name);
  return Array.from(names).sort((a, b) => a.localeCompare(b));
});

const downloadedVersionsForSelected = computed(() => {
  return installedPacks.value
    .filter((p) => p.name === selectedPackName.value)
    .slice()
    .sort((a, b) => compareVersionDesc(a.version, b.version));
});

const selectedDownloadedPack = computed(() => {
  return downloadedVersionsForSelected.value.find((p) => p.path === selectedPackPath.value);
});

const selectedPackLatestVersion = computed(() => {
  const match = packUpdates.value.find((u) => u.name === selectedPackName.value);
  return match?.latestVersion || "";
});

const installedProjectPackName = computed(() => guidanceStatus.value?.manifest?.name || "");
const installedProjectPackVersion = computed(() => guidanceStatus.value?.manifest?.version || "");
const installedProjectPackSource = computed(() => guidanceStatus.value?.source);

const switchingPackName = computed(() => {
  const installedName = installedProjectPackName.value;
  return Boolean(installedName && selectedPackName.value && selectedPackName.value !== installedName);
});

function syncPackSelection(): void {
  const installedName = installedProjectPackName.value;
  const currentNameValid = selectedPackName.value && availablePackNames.value.includes(selectedPackName.value);
  if (!currentNameValid) {
    if (installedName && availablePackNames.value.includes(installedName)) {
      selectedPackName.value = installedName;
    } else if (availablePackNames.value.includes("forge-guidance-pack")) {
      selectedPackName.value = "forge-guidance-pack";
    } else if (availablePackNames.value.length > 0) {
      selectedPackName.value = availablePackNames.value[0]!;
    }
  }

  const versions = downloadedVersionsForSelected.value;
  if (versions.length === 0) {
    selectedPackPath.value = "";
    return;
  }

  const currentPathValid = selectedPackPath.value && versions.some((v) => v.path === selectedPackPath.value);
  if (currentPathValid) {
    return;
  }

  const installedVersion = installedProjectPackVersion.value;
  const matchingInstalled = installedVersion
    ? versions.find((v) => v.version === installedVersion)
    : undefined;

  selectedPackPath.value = (matchingInstalled ?? versions[0]!).path;
}

const current = reactive<RunNextResult>({
  state: "idle",
  message: "Not started"
});

const streaming = ref(false);
const streamId = ref("");
const streamInput = ref("");
let eventSource: EventSource | null = null;

type LiveOutputSegment = {
  stream: "stdout" | "stderr" | "system";
  text: string;
};

const liveOutput = ref<LiveOutputSegment[]>([]);
const liveOutputTick = ref(0);
const MAX_OUTPUT_SEGMENTS = 2000;

function clearLiveOutput(): void {
  liveOutput.value = [];
  liveOutputTick.value++;
}

function appendLiveOutput(stream: LiveOutputSegment["stream"], text: string): void {
  if (!text) return;
  const segments = liveOutput.value;
  const last = segments.length > 0 ? segments[segments.length - 1] : undefined;
  if (last && last.stream === stream) {
    last.text += text;
  } else {
    segments.push({ stream, text });
  }

  if (segments.length > MAX_OUTPUT_SEGMENTS) {
    segments.splice(0, segments.length - MAX_OUTPUT_SEGMENTS);
  }
  liveOutputTick.value++;
}

type DiscoveredPlan = {
  filename: string;
  path: string;
  modifiedMs: number;
  valid: boolean | null;
  validating: boolean;
  taskStatuses: TaskStatus[];
  issues: ValidationIssue[];
};

const discoveredPlans = ref<DiscoveredPlan[]>([]);
let pollInterval: ReturnType<typeof setInterval> | null = null;

const selectedDiscoveredPlan = computed(() => discoveredPlans.value.find((p) => p.path === planPath.value));

const selectedPlanStatuses = computed(() => {
  return selectedDiscoveredPlan.value?.taskStatuses ?? [];
});

const selectedPlanIssues = computed(() => {
  return selectedDiscoveredPlan.value?.issues ?? [];
});

const validationSummary = computed(() => {
  if (!planPath.value) return "No plan selected";
  const selected = selectedDiscoveredPlan.value;
  if (!selected) return "Plan not discovered yet";
  if (selected.validating) return "Validating...";
  if (selected.valid === true) return "Plan valid";
  if (selected.valid === false) return `Plan invalid (${selected.issues.length} issues)`;
  return "Plan not validated yet";
});

onMounted(async () => {
  try {
    installedPacks.value = await packsListInstalled();
    packLogs.value.unshift(`Loaded ${installedPacks.value.length} pack(s) on startup`);
    syncPackSelection();
  } catch (error) {
    packLogs.value.unshift(`Startup pack load error: ${String(error)}`);
  }
});

async function pollPlans(): Promise<void> {
  try {
    const entries: PlanFileEntry[] = await plansList(projectRoot.value);
    const merged = mergeDiscoveredPlans(discoveredPlans.value, entries, { guidedOpen: showNewPlan.value });
    discoveredPlans.value = merged.plans;
    if (showNewPlan.value && merged.updatedFilenames.length) {
      for (const filename of merged.updatedFilenames) pushLog(`Plan updated during guided flow: ${filename}`);
    }

    // Auto-validate new or updated plans
    for (const plan of discoveredPlans.value) {
      if (plan.valid === null && !plan.validating) {
        plan.validating = true;
        const validatingForModifiedMs = plan.modifiedMs;
        planValidate(projectRoot.value, plan.path)
          .then((r) => {
            if (plan.modifiedMs !== validatingForModifiedMs) return;
            plan.valid = r.valid;
            plan.issues = r.issues;
          })
          .catch((error) => {
            if (plan.modifiedMs !== validatingForModifiedMs) return;
            plan.valid = false;
            plan.issues = [{ path: "", code: "validation_failed", message: String(error) }];
            pushLog(`Plan validation failed (${plan.filename}): ${String(error)}`);
          })
          .finally(() => {
            if (plan.modifiedMs !== validatingForModifiedMs) return;
            plan.validating = false;
          });
      }
    }

    // Fetch task statuses for the selected plan
    if (planPath.value) {
      try {
        const status = await plansStatus(projectRoot.value, planPath.value);
        const selected = discoveredPlans.value.find((p) => p.path === planPath.value);
        if (selected) selected.taskStatuses = status.tasks;
      } catch {
        // status polling is best-effort
      }
    }
  } catch {
    // polling is best-effort
  }
}

function startPolling(): void {
  stopPolling();
  pollPlans();
  pollInterval = setInterval(pollPlans, 5000);
}

function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

watch(tab, (newTab) => {
  if (newTab === "orchestrate") {
    startPolling();
  } else {
    stopPolling();
  }
});

watch(projectRoot, () => {
  // When switching projects, refresh pack + guidance context automatically.
  onRefreshGuidance();
  onListInstalledPacks();
});

watch(selectedPackName, () => {
  // Keep selectedPackPath aligned to the selected pack name.
  const versions = downloadedVersionsForSelected.value;
  if (!versions.some((v) => v.path === selectedPackPath.value)) {
    selectedPackPath.value = versions[0]?.path ?? "";
  }
});

onUnmounted(() => {
  stopPolling();
  stopStream();
});

// Resolve cwd on startup, then start polling
onMounted(async () => {
  const saved = (() => {
    try {
      return localStorage.getItem(LAST_PROJECT_ROOT_KEY) || "";
    } catch {
      return "";
    }
  })();

  if (saved.trim()) {
    projectRoot.value = saved.trim();
  } else {
    try {
      projectRoot.value = await getCwd();
    } catch {
      // fall back to "." if cwd resolution fails
    }
  }
  if (tab.value === "orchestrate") {
    startPolling();
  }
});

function onSelectPlan(plan: DiscoveredPlan): void {
  planPath.value = plan.path;
  logs.value.unshift(`Selected plan: ${plan.filename}`);

  if (!plan.validating) {
    plan.validating = true;
    planValidate(projectRoot.value, plan.path)
      .then((r) => {
        plan.valid = r.valid;
        plan.issues = r.issues;
      })
      .catch((error) => {
        plan.valid = false;
        plan.issues = [{ path: "", code: "validation_failed", message: String(error) }];
        pushLog(`Plan validation failed (${plan.filename}): ${String(error)}`);
      })
      .finally(() => {
        plan.validating = false;
      });
  }

  // Fetch task statuses
  plansStatus(projectRoot.value, plan.path)
    .then((status) => {
      plan.taskStatuses = status.tasks;
    })
    .catch(() => {
      // best-effort
    });
}

async function onBrowseProjectRoot(): Promise<void> {
  try {
    const folder = await selectFolder();
    if (folder) {
      projectRoot.value = folder;
      try {
        localStorage.setItem(LAST_PROJECT_ROOT_KEY, folder);
      } catch {
        // best-effort
      }
    }
  } catch (error) {
    logs.value.unshift(`Folder picker failed: ${String(error)}`);
  }
}

function onProjectCreated(newProjectRoot: string): void {
  projectRoot.value = newProjectRoot;
  try {
    localStorage.setItem(LAST_PROJECT_ROOT_KEY, newProjectRoot);
  } catch {
    // best-effort
  }
  tab.value = "orchestrate";
  logs.value.unshift(`Project created: ${newProjectRoot}`);
}

function onPlanCreated(planPathArg?: string): void {
  if (planPathArg) {
    const match = discoveredPlans.value.find((p) => p.path === planPathArg);
    if (match) {
      onSelectPlan(match);
      logs.value.unshift(`Plan created and selected: ${match.filename}`);
      return;
    }
  }
  logs.value.unshift("Plan created via guided flow");
}

async function ensurePlanValidForRun(): Promise<boolean> {
  try {
    const result = await planValidate(projectRoot.value, planPath.value);
    const selected = selectedDiscoveredPlan.value;
    if (selected) {
      selected.valid = result.valid;
      selected.issues = result.issues;
    }
    if (!result.valid) {
      pushLog(`Run blocked: plan invalid (${result.issues.length} issues)`);
      return false;
    }
    return true;
  } catch (error) {
    const selected = selectedDiscoveredPlan.value;
    if (selected) {
      selected.valid = false;
      selected.issues = [{ path: "", code: "validation_failed", message: String(error) }];
    }
    pushLog(`Run blocked: plan validation failed (${String(error)})`);
    return false;
  }
}

function stopStream(): void {
  streaming.value = false;
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function pushLog(line: string): void {
  logs.value.unshift(line);
  if (logs.value.length > 800) {
    logs.value.length = 800;
  }
}

async function onRunNextStream(): Promise<void> {
  stopStream();
  clearLiveOutput();

  const valid = await ensurePlanValidForRun();
  if (!valid) {
    current.state = "idle";
    current.message = "Plan invalid";
    return;
  }

  current.state = "running";
  current.taskId = undefined;
  current.runId = undefined;
  current.externalRunId = undefined;
  current.resumeCommand = undefined;
  current.message = "Running (stream)...";
  streamId.value = "";
  streamInput.value = "";
  streaming.value = true;

  pushLog("Run (stream) -> started");

  const url = runNextStreamUrl(projectRoot.value, planPath.value, adapter.value);
  eventSource = new EventSource(url);

  eventSource.addEventListener("message", (event) => {
    const raw = (event as MessageEvent).data as string;
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      appendLiveOutput("system", raw.endsWith("\n") ? raw : `${raw}\n`);
      return;
    }

    const type = String(parsed?.type ?? "");
    if (type === "sse.meta") {
      streamId.value = String(parsed.streamId ?? "");
      if (streamId.value) pushLog(`  streamId: ${streamId.value}`);
      return;
    }

    if (type === "process.stderr") {
      pushLog(`  [forge stderr] ${String(parsed.line ?? "")}`);
      return;
    }

    if (type === "adapter.event") {
      const e = parsed.event;
      if (e?.type === "run.output") {
        const stream = String(e.stream ?? "stdout");
        const chunk = String(e.chunk ?? "");
        appendLiveOutput(stream === "stderr" ? "stderr" : "stdout", chunk);
      } else if (e?.type === "run.tool") {
        const tool = String(e.tool ?? "tool");
        const status = String(e.status ?? "");
        appendLiveOutput("system", `[tool] ${tool}${status ? ` ${status}` : ""}\n`);
      } else if (e?.type === "run.failed") {
        appendLiveOutput("stderr", `[failed] ${String(e.reason ?? "")}\n`);
      } else if (e?.type) {
        appendLiveOutput("system", `[event] ${String(e.type)}\n`);
      }
      return;
    }

    if (type === "run.next.result") {
      const result = parsed.result as RunNextResult | undefined;
      if (result) {
        current.state = result.state;
        current.taskId = result.taskId;
        current.runId = result.runId;
        current.externalRunId = result.externalRunId;
        current.resumeCommand = result.resumeCommand;
        current.message = result.message;
        pushLog(`Run (stream) -> ${result.message}`);
        if (result.runId) pushLog(`  runId: ${result.runId}`);
        if (result.externalRunId) pushLog(`  externalRunId: ${result.externalRunId}`);
        if (result.resumeCommand) pushLog(`  resume: ${result.resumeCommand}`);
        if (result.classification) pushLog(`  classification: ${result.classification}`);
        if (result.checksSummary?.length) {
          for (const check of result.checksSummary) {
            pushLog(`  ${check}`);
          }
        }
        if (result.llmOutput?.length) {
          pushLog("  adapter output (tail):");
          for (const line of result.llmOutput) {
            pushLog(`    ${line}`);
          }
        }
      } else {
        pushLog("Run (stream) -> missing result payload");
      }
      stopStream();
      return;
    }

    if (type === "process.exit") {
      pushLog(`  [forge exit] ${String(parsed.code ?? "")}`);
      return;
    }

    appendLiveOutput("system", type ? `[${type}] ${raw}\n` : `${raw}\n`);
  });

  eventSource.addEventListener("error", () => {
    pushLog("Run (stream) -> SSE error/disconnected");
  });
}

async function onSendStreamInput(): Promise<void> {
  const text = streamInput.value.trim();
  if (!text || !streamId.value) return;
  try {
    await runNextStreamInput(streamId.value, text);
    pushLog(`  [input] ${text}`);
    streamInput.value = "";
  } catch (error) {
    pushLog(`  [input error] ${String(error)}`);
  }
}

async function onCancelStream(): Promise<void> {
  if (!streamId.value) return;
  try {
    await runNextStreamCancel(streamId.value);
    pushLog("Run (stream) -> cancel requested");
  } catch (error) {
    pushLog(`Run (stream) -> cancel error: ${String(error)}`);
  } finally {
    stopStream();
  }
}

async function onOpenEvidence(): Promise<void> {
  if (!current.taskId) {
    logs.value.unshift("Open Evidence -> no task selected");
    return;
  }

  try {
    evidence.value = await getEvidence(projectRoot.value, current.taskId);
    logs.value.unshift(`Open Evidence -> ${evidence.value.length} entries`);
  } catch (error) {
    logs.value.unshift(`Open Evidence -> error: ${String(error)}`);
  }
}

async function onRefreshGuidance(): Promise<void> {
  guidanceError.value = "";
  try {
    guidanceStatus.value = await projectGetGuidanceStatus(projectRoot.value);
    packLogs.value.unshift("Guidance status refreshed");
    syncPackSelection();
  } catch (error) {
    guidanceError.value = String(error);
    packLogs.value.unshift(`Guidance status error: ${String(error)}`);
  }
}

async function onListInstalledPacks(): Promise<void> {
  try {
    installedPacks.value = await packsListInstalled();
    packLogs.value.unshift(`Installed packs refreshed (${installedPacks.value.length})`);
    syncPackSelection();
  } catch (error) {
    packLogs.value.unshift(`Installed packs error: ${String(error)}`);
  }
}

async function onCheckUpdates(): Promise<void> {
  packUpdates.value = [];
  try {
    const statuses = await packsCheckUpdates();
    packUpdates.value = statuses;
    packLogs.value.unshift("Update check complete");
    syncPackSelection();
  } catch (error) {
    packLogs.value.unshift(`Update check error: ${String(error)}`);
    guidanceError.value = String(error);
  }
}

async function onDownloadLatestGuidance(): Promise<void> {
  guidanceError.value = "";
  try {
    const installed = await packsDownload(selectedPackName.value, selectedPackLatestVersion.value || undefined);
    packLogs.value.unshift(`Downloaded ${installed.name} @ ${installed.version}`);
    await onListInstalledPacks();
    selectedPackName.value = installed.name;
    selectedPackPath.value = installed.path;
  } catch (error) {
    guidanceError.value = String(error);
    packLogs.value.unshift(`Download error: ${String(error)}`);
  }
}

async function onInstallGuidance(): Promise<void> {
  if (!selectedPackPath.value) {
    packLogs.value.unshift("Install guidance -> no downloaded pack");
    return;
  }

  guidanceError.value = "";
  try {
    await projectInstallGuidance(projectRoot.value, selectedPackPath.value, forceReplace.value);
    packLogs.value.unshift("Guidance installed into project");
    await onRefreshGuidance();
  } catch (error) {
    guidanceError.value = String(error);
    packLogs.value.unshift(`Install guidance error: ${String(error)}`);
  }
}

function onSelectInstalledPack(pack: InstalledPack): void {
  selectedPackName.value = pack.name;
  selectedPackPath.value = pack.path;
}
</script>
