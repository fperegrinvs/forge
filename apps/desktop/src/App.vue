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
                      <v-btn size="small" variant="text" @click="onBrowseProjectRoot">Browse</v-btn>
                    </template>
                  </v-text-field>
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

                  <v-select v-model="adapter" :items="['codex', 'claude']" label="Adapter" density="comfortable" />

                  <div class="d-flex flex-wrap ga-2">
                    <v-btn color="primary" variant="outlined" prepend-icon="mdi-file-document-plus-outline" @click="showNewPlan = true">New Plan</v-btn>
                    <v-btn color="primary" @click="onValidate">Validate Plan</v-btn>
                    <v-btn color="primary" variant="outlined" @click="onRunNext">Run</v-btn>
                    <v-btn color="secondary" variant="outlined" @click="onOpenEvidence">Open Evidence</v-btn>
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
                  <p><strong>ID:</strong> {{ current.taskId || "-" }}</p>
                  <p><strong>Status:</strong> {{ current.state || "-" }}</p>
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
                  <h2 class="text-h6 mb-3">Guidance Pack</h2>
                  <v-text-field v-model="projectRoot" label="Project root" density="comfortable" readonly @click="onBrowseProjectRoot">
                    <template #append>
                      <v-btn size="small" variant="text" @click="onBrowseProjectRoot">Browse</v-btn>
                    </template>
                  </v-text-field>

                  <div class="d-flex flex-wrap ga-2 mb-3">
                    <v-btn color="primary" variant="outlined" @click="onRefreshGuidance">Refresh Status</v-btn>
                    <v-btn color="primary" variant="outlined" @click="onCheckUpdates">Check Updates</v-btn>
                  </div>

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
                  <p class="mb-3">
                    <strong>Latest:</strong>
                    <span>{{ latestGuidanceVersion || "-" }}</span>
                  </p>

                  <div class="d-flex flex-wrap ga-2 align-center">
                    <v-btn color="primary" :disabled="!latestGuidanceVersion" @click="onDownloadLatestGuidance">
                      Download Latest
                    </v-btn>
                    <v-btn
                      color="primary"
                      variant="outlined"
                      :disabled="!downloadedGuidancePackPath"
                      @click="onInstallGuidance"
                    >
                      Install/Update In Project
                    </v-btn>
                    <v-checkbox v-model="forceReplace" label="Force replace local changes" density="compact" hide-details />
                  </div>

                  <p v-if="downloadedGuidancePackPath" class="mt-3 text-body-2">
                    <strong>Downloaded pack:</strong> {{ downloadedGuidancePackPath }}
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
import PlanGraph from "./components/PlanGraph.vue";
import {
  getEvidence,
  packsCheckUpdates,
  packsDownload,
  packsListInstalled,
  planValidate,
  plansList,
  plansRead,
  plansStatus,
  projectGetGuidanceStatus,
  projectInstallGuidance,
  runNext,
  selectFolder,
  type InstalledPack,
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
const projectRoot = ref(".");
const planPath = ref("./plan.json");
const validationSummary = ref("No validation run yet");
const logs = ref<string[]>([]);
const evidence = ref<string[]>([]);

const guidanceStatus = ref<ProjectGuidanceStatus>();
const guidanceError = ref<string>("");
const latestGuidanceVersion = ref<string>("");
const downloadedGuidancePackPath = ref<string>("");
const forceReplace = ref(false);
const installedPacks = ref<InstalledPack[]>([]);
const packLogs = ref<string[]>([]);

const current = reactive<RunNextResult>({
  state: "idle",
  message: "Not started"
});

type DiscoveredPlan = {
  filename: string;
  path: string;
  valid: boolean | null;
  validating: boolean;
  taskStatuses: TaskStatus[];
  issues: ValidationIssue[];
};

const discoveredPlans = ref<DiscoveredPlan[]>([]);
const tasks = ref<{ id: string; dependencies: string[] }[]>([]);
let pollInterval: ReturnType<typeof setInterval> | null = null;

const selectedPlanStatuses = computed(() => {
  const selected = discoveredPlans.value.find((p) => p.path === planPath.value);
  return selected?.taskStatuses ?? [];
});

const selectedPlanIssues = computed(() => {
  const selected = discoveredPlans.value.find((p) => p.path === planPath.value);
  return selected?.issues ?? [];
});

onMounted(async () => {
  try {
    installedPacks.value = await packsListInstalled();
    const guidance = installedPacks.value.find((p) => p.name === "forge-guidance-pack");
    if (guidance) {
      downloadedGuidancePackPath.value = guidance.path;
    }
    packLogs.value.unshift(`Loaded ${installedPacks.value.length} pack(s) on startup`);
  } catch (error) {
    packLogs.value.unshift(`Startup pack load error: ${String(error)}`);
  }
});

async function pollPlans(): Promise<void> {
  try {
    const entries: PlanFileEntry[] = await plansList(projectRoot.value);
    const existing = new Map(discoveredPlans.value.map((p) => [p.filename, p]));
    const updated: DiscoveredPlan[] = entries.map((entry) => {
      const prev = existing.get(entry.filename);
      if (prev) return prev;
      return { filename: entry.filename, path: entry.path, valid: null, validating: false, taskStatuses: [], issues: [] };
    });
    discoveredPlans.value = updated;

    // Auto-validate new plans
    for (const plan of updated) {
      if (plan.valid === null && !plan.validating) {
        plan.validating = true;
        planValidate(projectRoot.value, plan.path)
          .then((r) => {
            plan.valid = r.valid;
            plan.issues = r.issues;
          })
          .catch(() => {
            plan.valid = false;
          })
          .finally(() => {
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

onUnmounted(() => {
  stopPolling();
});

// Start polling if we're on the orchestrate tab initially
onMounted(() => {
  if (tab.value === "orchestrate") {
    startPolling();
  }
});

function onSelectPlan(plan: DiscoveredPlan): void {
  planPath.value = plan.path;
  logs.value.unshift(`Selected plan: ${plan.filename}`);

  // Load the plan JSON to populate the DAG
  plansRead(plan.path)
    .then((json: unknown) => {
      const planJson = json as { tasks?: { id: string; dependencies: string[] }[] };
      if (Array.isArray(planJson.tasks)) {
        tasks.value = planJson.tasks.map((t) => ({
          id: t.id,
          dependencies: Array.isArray(t.dependencies) ? t.dependencies : []
        }));
      }
    })
    .catch(() => {
      logs.value.unshift("Could not parse plan for DAG");
    });

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
    }
  } catch (error) {
    logs.value.unshift(`Folder picker failed: ${String(error)}`);
  }
}

function onProjectCreated(newProjectRoot: string): void {
  projectRoot.value = newProjectRoot;
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
  logs.value.unshift("Plan created via guided flow — validate to load");
}

async function onValidate(): Promise<void> {
  try {
    const result = await planValidate(projectRoot.value, planPath.value);
    validationSummary.value = result.valid ? "Plan valid" : `Plan invalid (${result.issues.length} issues)`;
    const selected = discoveredPlans.value.find((p) => p.path === planPath.value);
    if (selected) {
      selected.valid = result.valid;
      selected.issues = result.issues;
    }
    logs.value.unshift(`Validate Plan -> ${validationSummary.value}`);
  } catch (error) {
    validationSummary.value = "Plan validation failed";
    logs.value.unshift(`Validate Plan -> error: ${String(error)}`);
  }
}

async function onRunNext(): Promise<void> {
  try {
    const result = await runNext(projectRoot.value, planPath.value, adapter.value);
    current.state = result.state;
    current.taskId = result.taskId;
    current.message = result.message;
    logs.value.unshift(`Run -> ${result.message}`);
    if (result.classification) {
      logs.value.unshift(`  classification: ${result.classification}`);
    }
    if (result.checksSummary?.length) {
      for (const check of result.checksSummary) {
        logs.value.unshift(`  ${check}`);
      }
    }
  } catch (error) {
    logs.value.unshift(`Run -> error: ${String(error)}`);
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
  } catch (error) {
    guidanceError.value = String(error);
    packLogs.value.unshift(`Guidance status error: ${String(error)}`);
  }
}

async function onListInstalledPacks(): Promise<void> {
  try {
    installedPacks.value = await packsListInstalled();
    packLogs.value.unshift(`Installed packs refreshed (${installedPacks.value.length})`);
  } catch (error) {
    packLogs.value.unshift(`Installed packs error: ${String(error)}`);
  }
}

async function onCheckUpdates(): Promise<void> {
  latestGuidanceVersion.value = "";
  try {
    const statuses = await packsCheckUpdates();
    const guidance = statuses.find((s) => s.name === "forge-guidance-pack");
    latestGuidanceVersion.value = guidance?.latestVersion ?? "";
    packLogs.value.unshift("Update check complete");
  } catch (error) {
    packLogs.value.unshift(`Update check error: ${String(error)}`);
    guidanceError.value = String(error);
  }
}

async function onDownloadLatestGuidance(): Promise<void> {
  guidanceError.value = "";
  try {
    const installed = await packsDownload("forge-guidance-pack", latestGuidanceVersion.value || undefined);
    downloadedGuidancePackPath.value = installed.path;
    packLogs.value.unshift(`Downloaded ${installed.name} @ ${installed.version}`);
    await onListInstalledPacks();
  } catch (error) {
    guidanceError.value = String(error);
    packLogs.value.unshift(`Download error: ${String(error)}`);
  }
}

async function onInstallGuidance(): Promise<void> {
  if (!downloadedGuidancePackPath.value) {
    packLogs.value.unshift("Install guidance -> no downloaded pack");
    return;
  }

  guidanceError.value = "";
  try {
    await projectInstallGuidance(projectRoot.value, downloadedGuidancePackPath.value, forceReplace.value);
    packLogs.value.unshift("Guidance installed into project");
    await onRefreshGuidance();
  } catch (error) {
    guidanceError.value = String(error);
    packLogs.value.unshift(`Install guidance error: ${String(error)}`);
  }
}
</script>
