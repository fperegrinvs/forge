<template>
  <v-card class="pa-4 mb-4">
    <div class="d-flex align-center mb-2">
      <h2 class="text-h6">Live Output</h2>
      <v-spacer />
      <v-switch v-model="autoScroll" label="Auto-scroll" density="compact" hide-details />
      <v-btn class="ml-2" size="small" variant="outlined" @click="$emit('clear')">Clear</v-btn>
    </div>

    <div ref="scroller" class="terminal">
      <span
        v-for="(seg, idx) in segments"
        :key="idx"
        :class="seg.stream === 'stderr' ? 'stderr' : seg.stream === 'system' ? 'system' : 'stdout'"
      >
        {{ seg.text }}
      </span>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

export type LiveOutputSegment = {
  stream: "stdout" | "stderr" | "system";
  text: string;
};

const props = defineProps<{
  segments: LiveOutputSegment[];
  tick: number;
}>();

defineEmits<{
  clear: [];
}>();

const scroller = ref<HTMLElement | null>(null);
const autoScroll = ref(true);

async function scrollToBottom(): Promise<void> {
  await nextTick();
  if (!scroller.value) return;
  scroller.value.scrollTop = scroller.value.scrollHeight;
}

watch(
  () => props.tick,
  async () => {
    if (!autoScroll.value) return;
    await scrollToBottom();
  }
);

watch(
  () => autoScroll.value,
  async (enabled) => {
    if (!enabled) return;
    await scrollToBottom();
  }
);
</script>

<style scoped>
.terminal {
  height: 280px;
  overflow: auto;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #0b1220;
  color: #e5e7eb;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
  line-height: 1.35;
  white-space: pre-wrap;
  padding: 12px;
}

.stdout {
  color: #e5e7eb;
}

.stderr {
  color: #fca5a5;
}

.system {
  color: #93c5fd;
}
</style>
