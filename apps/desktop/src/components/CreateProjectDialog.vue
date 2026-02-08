<template>
  <v-dialog v-model="open" max-width="600" persistent>
    <v-card>
      <v-card-title>New Project</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="parentDir"
          label="Parent directory"
          density="comfortable"
          readonly
          @click="onBrowse"
        >
          <template #append>
            <v-btn size="small" variant="text" @click.stop="onBrowse">Browse</v-btn>
          </template>
        </v-text-field>

        <v-text-field
          v-model="projectName"
          label="Project name"
          density="comfortable"
          :rules="[v => !!v || 'Required']"
        />

        <v-select
          v-model="template"
          :items="templates"
          item-title="name"
          item-value="id"
          label="Template"
          density="comfortable"
          :loading="loadingTemplates"
        />

        <v-alert v-if="error" type="error" variant="tonal" class="mt-2">
          {{ error }}
        </v-alert>

        <v-alert v-if="successMessage" type="success" variant="tonal" class="mt-2">
          {{ successMessage }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="onClose">Cancel</v-btn>
        <v-btn
          color="primary"
          :loading="creating"
          :disabled="!parentDir || !projectName || !!successMessage"
          @click="onCreate"
        >
          Create
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import {
  listTemplates,
  projectInit,
  selectFolder,
  type ProjectTemplate
} from "../composables/useControlPlane";

const open = defineModel<boolean>({ default: false });

const emit = defineEmits<{
  created: [projectRoot: string];
}>();

const parentDir = ref("");
const projectName = ref("");
const template = ref("forge-template");
const templates = ref<ProjectTemplate[]>([]);
const loadingTemplates = ref(false);
const creating = ref(false);
const error = ref("");
const successMessage = ref("");

watch(open, (value) => {
  if (value) {
    error.value = "";
    successMessage.value = "";
  }
});

onMounted(async () => {
  loadingTemplates.value = true;
  try {
    templates.value = await listTemplates();
  } catch {
    templates.value = [{ id: "forge-template", name: "Forge Template", description: "Default" }];
  } finally {
    loadingTemplates.value = false;
  }
});

async function onBrowse(): Promise<void> {
  try {
    const folder = await selectFolder();
    if (folder) {
      parentDir.value = folder;
    }
  } catch (e) {
    error.value = `Folder picker failed: ${String(e)}`;
  }
}

async function onCreate(): Promise<void> {
  error.value = "";
  successMessage.value = "";
  creating.value = true;
  try {
    const result = await projectInit({
      parentDir: parentDir.value,
      projectName: projectName.value,
      template: template.value || undefined
    });
    if (result.success && result.projectRoot) {
      successMessage.value = `Project created at ${result.projectRoot}`;
      emit("created", result.projectRoot);
    } else {
      error.value = result.message || "Project creation failed";
    }
  } catch (e) {
    error.value = String(e);
  } finally {
    creating.value = false;
  }
}

function onClose(): void {
  open.value = false;
}
</script>
