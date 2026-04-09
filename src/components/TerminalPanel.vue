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

function renderPendingChunks() {
  if (!terminal) {
    return;
  }
  while (renderedCount < props.chunks.length) {
    terminal.write(props.chunks[renderedCount]);
    renderedCount += 1;
  }
  fitAddon?.fit();
}

function resetTerminal() {
  if (!terminal) {
    return;
  }
  terminal.clear();
  renderedCount = 0;
  renderPendingChunks();
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

function handleWindowResize() {
  if (resizeTimer !== null) {
    window.clearTimeout(resizeTimer);
  }
  resizeTimer = window.setTimeout(() => {
    fitAddon?.fit();
    reportTerminalSize();
    resizeTimer = null;
  }, 80);
}

onMounted(() => {
  terminal = new Terminal({
    convertEol: true,
    fontSize: 13,
    cursorBlink: true,
    disableStdin: !props.interactive,
    theme: {
      background: '#020617'
    }
  });
  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.onData((data) => {
    if (!props.interactive) {
      return;
    }
    queueInput(data);
  });
  if (containerRef.value) {
    terminal.open(containerRef.value);
    fitAddon.fit();
    reportTerminalSize();
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
  window.removeEventListener('resize', handleWindowResize);
  terminal?.dispose();
});

watch(() => props.chunks.length, () => renderPendingChunks());
watch(() => props.sessionId, () => {
  lastReportedSize = '';
  resetTerminal();
  reportTerminalSize();
});
watch(() => props.interactive, (interactive) => {
  if (terminal) {
    terminal.options.disableStdin = !interactive;
  }
});
</script>

<template>
  <div ref="containerRef" class="terminal-wrapper"></div>
</template>
