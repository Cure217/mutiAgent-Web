<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Terminal } from 'xterm';

const props = defineProps<{
  chunks: string[];
  sessionId?: string;
  interactive?: boolean;
}>();

const emit = defineEmits<{
  terminalInput: [data: string];
  terminalResize: [size: { cols: number; rows: number }];
}>();

const containerRef = ref<HTMLDivElement | null>(null);
let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let renderedCount = 0;
let pendingInput = '';
let flushTimer: number | null = null;
let resizeTimer: number | null = null;
let lastReportedSize = '';
let resizeObserver: ResizeObserver | null = null;
let userInputArmed = false;

function queueInput(data: string) {
  pendingInput += data;
  if (flushTimer !== null) {
    return;
  }
  flushTimer = window.setTimeout(() => {
    if (pendingInput) {
      emit('terminalInput', pendingInput);
      pendingInput = '';
    }
    if (flushTimer !== null) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
  }, 40);
}

function armUserInput() {
  userInputArmed = true;
}

function normalizeTerminalInputData(data: string) {
  return data.replace(/\x1b\[[IO]/g, '');
}

function renderPendingChunks() {
  if (!terminal) {
    return;
  }
  while (renderedCount < props.chunks.length) {
    terminal.write(props.chunks[renderedCount]);
    renderedCount += 1;
  }
}

function resetTerminal() {
  if (!terminal) {
    return;
  }
  terminal.reset();
  renderedCount = 0;
  fitAddon?.fit();
  renderPendingChunks();
  reportTerminalSize();
}

function flushInputNow() {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingInput) {
    emit('terminalInput', pendingInput);
    pendingInput = '';
  }
}

function reportTerminalSize() {
  if (!terminal) {
    return;
  }
  const sizeKey = `${terminal.cols}x${terminal.rows}`;
  if (sizeKey === lastReportedSize) {
    return;
  }
  lastReportedSize = sizeKey;
  emit('terminalResize', {
    cols: terminal.cols,
    rows: terminal.rows
  });
}

function scheduleResizeFit() {
  if (resizeTimer !== null) {
    window.clearTimeout(resizeTimer);
  }
  resizeTimer = window.setTimeout(() => {
    fitAddon?.fit();
    reportTerminalSize();
    resizeTimer = null;
  }, 80);
}

function handleWindowResize() {
  scheduleResizeFit();
}

onMounted(() => {
  terminal = new Terminal({
    convertEol: false,
    fontSize: 13,
    fontFamily: 'Cascadia Mono, Cascadia Code, Consolas, "Courier New", monospace',
    cursorBlink: true,
    disableStdin: !props.interactive,
    scrollback: 5000,
    windowsPty: {
      backend: 'conpty'
    },
    theme: {
      background: '#020617'
    }
  });
  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.onData((data) => {
    if (!props.interactive || !userInputArmed) {
      return;
    }
    const normalizedData = normalizeTerminalInputData(data);
    if (normalizedData) {
      queueInput(normalizedData);
    }
  });
  if (containerRef.value) {
    terminal.open(containerRef.value);
    fitAddon.fit();
    reportTerminalSize();
    resizeObserver = new ResizeObserver(() => {
      scheduleResizeFit();
    });
    resizeObserver.observe(containerRef.value);
  }
  renderPendingChunks();
  window.addEventListener('resize', handleWindowResize);
});

onBeforeUnmount(() => {
  flushInputNow();
  if (resizeTimer !== null) {
    window.clearTimeout(resizeTimer);
    resizeTimer = null;
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.removeEventListener('resize', handleWindowResize);
  terminal?.dispose();
});

watch(() => props.chunks.length, () => renderPendingChunks());
watch(() => props.sessionId, () => {
  lastReportedSize = '';
  userInputArmed = false;
  resetTerminal();
});
watch(() => props.interactive, (interactive) => {
  if (terminal) {
    terminal.options.disableStdin = !interactive;
  }
  if (!interactive) {
    userInputArmed = false;
  }
});
</script>

<template>
  <div
    ref="containerRef"
    class="terminal-wrapper"
    @keydown.capture="armUserInput"
    @paste.capture="armUserInput"
    @pointerdown.capture="armUserInput"
  ></div>
</template>

<style scoped>
.terminal-wrapper {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.terminal-wrapper :deep(.xterm) {
  height: 100%;
}

.terminal-wrapper :deep(.xterm-screen) {
  height: 100% !important;
}

.terminal-wrapper :deep(.xterm-viewport) {
  height: 100% !important;
  overflow-y: auto !important;
}
</style>
