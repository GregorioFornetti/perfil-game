<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { canPickTip } from '../game';
import type { GameView } from '../types';

const props = defineProps<{ view: GameView }>();
const emit = defineEmits<{ pick: [index: number] }>();
const { t } = useI18n();

const shown = (i: number) => props.view.round!.revealed.includes(i);
const latest = (i: number) => props.view.round!.revealed.at(-1) === i;
</script>

<template>
  <ol v-if="view.round" class="grid gap-2 md:grid-cols-2">
    <li v-for="(tip, i) in view.round.tips" :key="i">
      <button
        v-if="canPickTip(view, i)"
        data-test="pick"
        class="flex w-full cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-amber-400/70 bg-amber-400/10 px-3 py-2 text-left text-amber-200 transition hover:bg-amber-400/25"
        :aria-label="t('game.pick', { n: i + 1 })"
        @click="emit('pick', i)"
      >
        <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-slate-900">{{ i + 1 }}</span>
        <span class="text-sm font-medium">{{ t('game.pick', { n: i + 1 }) }}</span>
      </button>
      <div
        v-else
        data-test="tip"
        class="flex items-start gap-3 rounded-lg px-3 py-2"
        :class="[
          shown(i) || view.phase === 'roundEnd' || view.phase === 'finished' ? 'bg-slate-700/70' : 'bg-slate-800/60',
          latest(i) && view.phase === 'guessing' ? 'ring-2 ring-amber-300' : '',
          !shown(i) && tip !== null ? 'opacity-50' : '',
        ]"
      >
        <span
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold"
          :class="shown(i) ? 'bg-emerald-400 text-slate-900' : 'bg-slate-600 text-slate-300'"
          >{{ i + 1 }}</span
        >
        <span v-if="tip !== null" class="pt-0.5 text-sm leading-snug">{{ tip }}</span>
        <span v-else class="pt-0.5 text-sm italic text-slate-500">{{ t('game.hidden') }}</span>
      </div>
    </li>
  </ol>
</template>
