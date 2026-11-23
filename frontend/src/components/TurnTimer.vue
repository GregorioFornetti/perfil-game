<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

/** Counts down the time the player on turn has left. The server decides what happens at zero. */
const props = defineProps<{ timer: { limitMs: number; leftMs: number } }>();
const { t } = useI18n();

const endsAt = ref(0);
const left = ref(0);
// every state from the server says how much time was left when it was sent
watch(
  () => props.timer,
  (timer) => {
    endsAt.value = Date.now() + timer.leftMs;
    left.value = timer.leftMs;
  },
  { immediate: true },
);
const ticking = setInterval(() => (left.value = Math.max(0, endsAt.value - Date.now())), 200);
onBeforeUnmount(() => clearInterval(ticking));

const seconds = computed(() => Math.ceil(left.value / 1000));
const fraction = computed(() => (props.timer.limitMs > 0 ? Math.min(1, left.value / props.timer.limitMs) : 0));
const urgent = computed(() => left.value <= 5000);
</script>

<template>
  <div data-test="timer" class="mt-2 flex items-center gap-2" role="timer" :aria-label="t('game.timer.left', { n: seconds })">
    <div class="h-2 flex-1 overflow-hidden rounded-full bg-slate-900/60">
      <div
        class="h-full rounded-full transition-[width] duration-200 ease-linear"
        :class="urgent ? 'bg-rose-400' : 'bg-amber-300'"
        :style="{ width: `${(fraction * 100).toFixed(1)}%` }"
      ></div>
    </div>
    <span class="w-12 text-right font-mono text-sm font-bold tabular-nums" :class="urgent ? 'text-rose-300' : ''">⏱ {{ seconds }}</span>
  </div>
</template>
