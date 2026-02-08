<template>
  <div ref="terminalEl" class="terminal-panel" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { terminalResize, terminalWsUrl } from "../composables/useTerminal";

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
let resizeObserver: ResizeObserver | null = null;
let currentSessionId = "";

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

  currentSessionId = sessionId;

  if (terminalEl.value) {
    terminal.open(terminalEl.value);
    fitAddon.fit();
    terminal.focus();

    resizeObserver = new ResizeObserver(() => {
      if (fitAddon && terminal) {
        fitAddon.fit();
        const { cols, rows } = terminal;
        if (currentSessionId && cols > 0 && rows > 0) {
          terminalResize(currentSessionId, cols, rows).catch(() => {
            // Resize is best-effort; ignore errors
          });
        }
      }
    });
    resizeObserver.observe(terminalEl.value);
  }

  const url = terminalWsUrl(sessionId);
  let opened = false;
  ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  ws.addEventListener("open", () => {
    opened = true;
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

  ws.addEventListener("close", (event) => {
    if (!opened) {
      emit("error", `WebSocket closed before opening (url=${url})`);
      emit("disconnected");
      return;
    }
    const shouldRetry = !event.wasClean && event.code !== 1000 && event.code !== 1001;

    // Single retry on unexpected disconnect
    if (shouldRetry && currentSessionId && terminal) {
      const retryUrl = terminalWsUrl(currentSessionId);
      const retryWs = new WebSocket(retryUrl);
      retryWs.binaryType = "arraybuffer";
      retryWs.addEventListener("open", () => {
        ws = retryWs;
        retryWs.addEventListener("message", (event) => {
          if (terminal) {
            if (event.data instanceof ArrayBuffer) {
              terminal.write(new Uint8Array(event.data));
            } else {
              terminal.write(event.data as string);
            }
          }
        });
        retryWs.addEventListener("close", () => emit("disconnected"));
      });
      retryWs.addEventListener("error", () => {
        emit("error", `WebSocket connection error (url=${retryUrl})`);
        emit("disconnected");
      });
    } else {
      emit("disconnected");
    }
  });

  ws.addEventListener("error", () => {
    emit("error", `WebSocket connection error (url=${url})`);
  });

  terminal.onData((data) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

function cleanup(): void {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  if (terminal) {
    terminal.dispose();
    terminal = null;
  }
  fitAddon = null;
  currentSessionId = "";
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
