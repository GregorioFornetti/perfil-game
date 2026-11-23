<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import PlayerToken from './PlayerToken.vue';
import { ranking } from '../game';
import type { GameView } from '../types';

const props = defineProps<{ view: GameView }>();
const { t } = useI18n();
const players = computed(() => ranking(props.view));
</script>

<template>
  <section class="panel">
    <h2 class="mb-3 text-lg font-bold">{{ t('game.scoreboard') }}</h2>
    <ul class="flex flex-col gap-2">
      <li v-for="p in players" :key="p.id" data-test="score" class="flex items-center gap-2 text-sm" :class="{ 'opacity-50': !p.connected }">
        <PlayerToken :name="p.name" :color="p.color" :highlight="p.id === view.you" />
        <span class="flex-1 truncate font-medium">
          {{ p.name }}<template v-if="p.id === view.you"> ({{ t('lobby.you') }})</template>
        </span>
        <span v-if="view.round?.holderId === p.id && view.phase !== 'finished'" title="card">🃏</span>
        <span v-else-if="view.round?.turnId === p.id" title="turn">👉</span>
        <span v-if="view.winnerId === p.id">🏆</span>
        <span v-if="!p.connected" class="text-xs text-slate-400">{{ t('lobby.away') }}</span>
        <span class="w-8 text-right font-mono font-bold tabular-nums">{{ p.position }}</span>
      </li>
    </ul>
  </section>
</template>
