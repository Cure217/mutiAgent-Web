<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Terminal } from 'xterm';

const props = defineProps<{
  chunks: string[];
  sessionId?: string;
}>();

const containerRef = ref<HTMLDivElement | null>(null);
let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let renderedCount = 0;

function renderPendingChunks() {
  if (!terminal) {
    return;
  }
  while (renderedCount < props.chunks.length) {
    terminal.writeln(props.chunks[renderedCount]);
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

onMounted(() => {
  terminal = new Terminal({
    convertEol: true,
    fontSize: 13,
    theme: {
      background: '#020617'
    }
  });
  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  if (containerRef.value) {
    terminal.open(containerRef.value);
    fitAddon.fit();
  }
  renderPendingChunks();
  window.addEventListener('resize', fitAddon.fit);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', fitAddon?.fit as EventListener);
  terminal?.dispose();
});

watch(() => props.chunks.length, () => renderPendingChunks());
watch(() => props.sessionId, () => resetTerminal());
</script>

<template>
  <div ref="containerRef" class="terminal-wrapper"></div>
</template>
