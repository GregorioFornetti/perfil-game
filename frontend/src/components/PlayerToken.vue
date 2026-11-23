<script setup lang="ts">
import { computed } from 'vue';
import { initial, TOKEN_COLORS } from '../colors';
import type { PlayerColor } from '../types';

const props = defineProps<{ name: string; color: PlayerColor; highlight?: boolean; large?: boolean }>();
const paint = computed(() => TOKEN_COLORS[props.color] ?? TOKEN_COLORS.white);
</script>

<template>
  <span
    data-test="token"
    :data-color="color"
    :title="name"
    class="inline-flex shrink-0 select-none items-center justify-center rounded-full border-2 font-extrabold leading-none shadow-md"
    :class="[
      large ? 'h-8 w-8 text-sm' : 'h-5 w-5 text-[10px] sm:h-6 sm:w-6 sm:text-xs',
      highlight ? 'border-white ring-2 ring-white/40' : 'border-slate-900/60',
    ]"
    :style="{ backgroundColor: paint.bg, color: paint.fg }"
    >{{ initial(name) }}</span
  >
</template>
