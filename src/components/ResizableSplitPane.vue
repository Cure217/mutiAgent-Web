<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';

const props = withDefaults(defineProps<{
  ratio: number;
  minRatio?: number;
  maxRatio?: number;
  disabled?: boolean;
  collapsed?: boolean;
}>(), {
  minRatio: 0.32,
  maxRatio: 0.72,
  disabled: false,
  collapsed: false
});

const emit = defineEmits<{
  'update:ratio': [value: number];
}>();

const containerRef = ref<HTMLDivElement | null>(null);
let dragging = false;
let previousCursor = '';
let previousUserSelect = '';

const primaryStyle = computed(() => ({
  flexBasis: `calc(${props.ratio * 100}% - 4px)`
}));

const secondaryStyle = computed(() => ({
  flexBasis: `calc(${(1 - props.ratio) * 100}% - 4px)`
}));

function clampRatio(value: number) {
  return Math.min(props.maxRatio, Math.max(props.minRatio, value));
}

function restoreDocumentState() {
  document.body.style.cursor = previousCursor;
  document.body.style.userSelect = previousUserSelect;
}

function stopDragging() {
  if (!dragging) {
    return;
  }
  dragging = false;
  restoreDocumentState();
  window.removeEventListener('mousemove', handlePointerMove);
  window.removeEventListener('mouseup', stopDragging);
}

function handlePointerMove(event: MouseEvent) {
  if (!dragging || !containerRef.value) {
    return;
  }
  const bounds = containerRef.value.getBoundingClientRect();
  if (!bounds.width) {
    return;
  }
  const nextRatio = clampRatio((event.clientX - bounds.left) / bounds.width);
  emit('update:ratio', Number(nextRatio.toFixed(4)));
}

function startDragging(event: MouseEvent) {
  if (props.disabled || props.collapsed || !containerRef.value) {
    return;
  }
  event.preventDefault();
  dragging = true;
  previousCursor = document.body.style.cursor;
  previousUserSelect = document.body.style.userSelect;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  window.addEventListener('mousemove', handlePointerMove);
  window.addEventListener('mouseup', stopDragging);
}

onBeforeUnmount(() => {
  stopDragging();
});
</script>

<template>
  <div ref="containerRef" class="split-pane" :class="{ 'is-disabled': disabled, 'is-collapsed': collapsed }">
    <section class="split-pane__primary" :style="primaryStyle">
      <slot name="primary" />
    </section>
    <div class="split-pane__divider" @mousedown="startDragging" />
    <section class="split-pane__secondary" :style="secondaryStyle">
      <slot name="secondary" />
    </section>
  </div>
</template>

<style scoped>
.split-pane {
  display: flex;
  align-items: flex-start;
  width: 100%;
  min-width: 0;
  gap: 0;
}

.split-pane__primary,
.split-pane__secondary {
  min-width: 0;
}

.split-pane__primary {
  flex: 0 0 auto;
}

.split-pane__secondary {
  flex: 1 1 auto;
}

.split-pane__divider {
  width: 8px;
  flex: 0 0 8px;
  align-self: stretch;
  cursor: col-resize;
  position: relative;
}

.split-pane__divider::before {
  content: '';
  position: absolute;
  top: 10px;
  bottom: 10px;
  left: 3px;
  width: 2px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.5);
  transition: background 0.18s ease;
}

.split-pane__divider:hover::before {
  background: rgba(59, 130, 246, 0.9);
}

.split-pane.is-disabled .split-pane__divider {
  cursor: default;
}

.split-pane.is-disabled .split-pane__divider::before {
  background: rgba(148, 163, 184, 0.28);
}

.split-pane.is-collapsed .split-pane__primary,
.split-pane.is-collapsed .split-pane__divider {
  display: none;
}

.split-pane.is-collapsed .split-pane__secondary {
  flex-basis: 100%;
}
</style>
