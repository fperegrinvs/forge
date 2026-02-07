<template>
  <div ref="terminalEl" class="terminal-panel" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { terminalWsUrl } from "../composables/useTerminal";

const props = defineProps<{
  sessionId: string;
}>();

const emit = defineEmits<{
  connected: [];
  disconnected: [];
  error: [message: string];
}>();

const terminalEl = ref<HTMLElement>();

let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let ws: WebSocket | null = null;

function connect(sessionId: string): void {
  cleanup();

  terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "Menlo, Monaco, 'Courier New', monospace",
    theme: {
      background: "#1e1e1e",
      foreground: "#d4d4d4"
    }
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());

  if (terminalEl.value) {
    terminal.open(terminalEl.value);
    fitAddon.fit();
  }

  const url = terminalWsUrl(sessionId);
  ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  ws.addEventListener("open", () => {
    emit("connected");
  });

  ws.addEventListener("message", (event) => {
    if (terminal) {
      if (event.data instanceof ArrayBuffer) {
        terminal.write(new Uint8Array(event.data));
      } else {
        terminal.write(event.data as string);
      }
    }
  });

  ws.addEventListener("close", () => {
    emit("disconnected");
  });

  ws.addEventListener("error", () => {
    emit("error", "WebSocket connection error");
  });

  terminal.onData((data) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

function cleanup(): void {
  if (ws) {
    ws.close();
    ws = null;
  }
  if (terminal) {
    terminal.dispose();
    terminal = null;
  }
  fitAddon = null;
}

onMounted(() => {
  if (props.sessionId) {
    connect(props.sessionId);
  }
});

watch(
  () => props.sessionId,
  (newId) => {
    if (newId) {
      connect(newId);
    } else {
      cleanup();
    }
  }
);

onBeforeUnmount(() => {
  cleanup();
});

defineExpose({
  fit: () => fitAddon?.fit()
});
</script>

<style scoped>
.terminal-panel {
  width: 100%;
  height: 100%;
  min-height: 300px;
}
</style>
