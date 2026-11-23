<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { acceptableGuessIds, playerById } from '../game';
import type { GameView } from '../types';

const props = defineProps<{ view: GameView }>();
const emit = defineEmits<{ accept: [guessId: number] }>();
const { t } = useI18n();

const guesses = computed(() => [...(props.view.round?.guesses ?? [])].reverse());
const acceptable = computed(() => acceptableGuessIds(props.view));
const name = (id: string) => playerById(props.view, id)?.name ?? t('game.someone');
</script>

<template>
  <section class="panel">
    <h2 class="mb-3 text-lg font-bold">{{ t('game.guesses') }}</h2>
    <p v-if="guesses.length === 0" class="text-sm text-slate-400">{{ t('game.noGuesses') }}</p>
    <p v-else-if="acceptable.length" class="mb-3 text-xs text-slate-400">{{ t('game.acceptHint') }}</p>
    <ul class="flex flex-col gap-2">
      <li v-for="g in guesses" :key="g.id" data-test="guess-entry" class="rounded-lg bg-slate-700/60 px-3 py-2 text-sm">
        <div class="flex items-center gap-2">
          <span class="font-semibold">{{ name(g.playerId) }}</span>
          <span class="text-xs text-slate-400">{{ t('game.afterTips', { n: g.tipsRevealed }, g.tipsRevealed) }}</span>
          <span
            class="ml-auto rounded px-2 py-0.5 text-xs font-semibold"
            :class="g.correct ? 'bg-emerald-500/30 text-emerald-200' : 'bg-rose-500/30 text-rose-200'"
            >{{ g.correct ? t('game.right') : t('game.wrong') }}</span
          >
        </div>
        <p class="mt-1 break-words text-base">“{{ g.text }}”</p>
        <button v-if="acceptable.includes(g.id)" data-test="accept" class="btn btn-secondary mt-2 px-2 py-1 text-xs" @click="emit('accept', g.id)">
          ✓ {{ t('game.accept') }}
        </button>
      </li>
    </ul>
  </section>
</template>
