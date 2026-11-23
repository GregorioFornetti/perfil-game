<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import GameOptionsModal from './GameOptionsModal.vue';
import OwnCardsModal from './OwnCardsModal.vue';
import PlayerToken from './PlayerToken.vue';
import { countKinds } from '../board';
import { SPECIAL_STYLE } from '../specials';
import { TOKEN_COLORS } from '../colors';
import { connectedCount, isHost, me, playerById } from '../game';
import type { GameStore } from '../store';
import { isDefaultScoring, MIN_PLAYERS, PLAYER_COLORS, SPECIAL_KINDS, type GameView, type PlayerColor } from '../types';

const props = defineProps<{ store: GameStore; view: GameView }>();
const { t } = useI18n();

const optionsOpen = ref(false);
const ownCardsOpen = ref(false);
const copied = ref(false);
const host = computed(() => isHost(props.view));
const enough = computed(() => connectedCount(props.view) >= MIN_PLAYERS);
const hostName = computed(() => playerById(props.view, props.view.hostId)?.name ?? t('game.someone'));
/** How many special spaces of each kind the next board will have. */
const summaryCounts = computed(() =>
  props.view.settings.boardMode === 'custom' ? countKinds(props.view.settings.customBoard) : props.view.settings.specials,
);
const timeLimited = computed(() => props.view.settings.timers.tip > 0 || props.view.settings.timers.guess > 0);
const timeLabel = (seconds: number) => (seconds === 0 ? t('options.noLimit') : t('options.seconds', { n: seconds }));
const myColor = computed(() => me(props.view)?.color);
/** Who has each colour, so that taken ones can be shown as unavailable. */
const owner = (color: PlayerColor) => props.view.players.find((p) => p.color === color);
const colorTitle = (color: PlayerColor) => {
  const taken = owner(color);
  return taken && taken.id !== props.view.you
    ? t('lobby.colorTaken', { color: t(`colors.${color}`), name: taken.name })
    : t(`colors.${color}`);
};
const link = computed(() => `${window.location.origin}${window.location.pathname}#${props.view.code}`);

async function copyLink() {
  try {
    await navigator.clipboard.writeText(link.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    window.prompt(t('lobby.copyLink'), link.value);
  }
}
</script>

<template>
  <div class="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
    <section class="panel flex flex-col items-center gap-3 text-center">
      <span class="text-sm uppercase tracking-widest text-slate-400">{{ t('lobby.room') }}</span>
      <span data-test="room-code" class="font-mono text-6xl font-black tracking-[0.2em] text-amber-300">{{ view.code }}</span>
      <p class="text-sm text-slate-300">{{ t('lobby.share') }}</p>
      <button class="btn btn-secondary" @click="copyLink">{{ copied ? t('lobby.copied') : t('lobby.copyLink') }}</button>
    </section>

    <section class="panel flex flex-col gap-4">
      <h2 class="text-lg font-bold">{{ t('lobby.players') }} ({{ view.players.length }})</h2>
      <ul class="flex flex-col gap-2">
        <li
          v-for="p in view.players"
          :key="p.id"
          data-test="player"
          class="flex items-center gap-2 rounded-lg bg-slate-700/60 px-3 py-2"
          :class="{ 'opacity-50': !p.connected }"
        >
          <PlayerToken :name="p.name" :color="p.color" :highlight="p.id === view.you" />
          <span class="flex-1 truncate font-medium">{{ p.name }}</span>
          <span v-if="p.id === view.you" class="rounded bg-sky-500/30 px-2 py-0.5 text-xs text-sky-200">{{ t('lobby.you') }}</span>
          <span v-if="p.id === view.hostId" class="rounded bg-amber-400/30 px-2 py-0.5 text-xs text-amber-200">{{ t('lobby.host') }}</span>
          <span v-if="!p.connected" class="rounded bg-slate-500/40 px-2 py-0.5 text-xs">{{ t('lobby.away') }}</span>
        </li>
      </ul>

      <div class="flex flex-col gap-2">
        <span class="text-sm text-slate-300">{{ t('lobby.color') }}</span>
        <div class="flex flex-wrap gap-2" role="radiogroup" :aria-label="t('lobby.color')">
          <button
            v-for="color in PLAYER_COLORS"
            :key="color"
            type="button"
            role="radio"
            data-test="color"
            :data-color="color"
            :aria-checked="color === myColor"
            :aria-label="colorTitle(color)"
            :title="colorTitle(color)"
            :disabled="!!owner(color) && color !== myColor"
            class="flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-extrabold transition enabled:cursor-pointer enabled:hover:scale-110 disabled:cursor-not-allowed disabled:opacity-25"
            :class="color === myColor ? 'border-white ring-2 ring-white/50' : 'border-slate-900/60'"
            :style="{ backgroundColor: TOKEN_COLORS[color].bg, color: TOKEN_COLORS[color].fg }"
            @click="color !== myColor && store.setColor(color)"
          >
            <template v-if="color === myColor">✓</template>
            <template v-else-if="owner(color)">✕</template>
          </button>
        </div>
      </div>

      <!-- the options of the next game: everybody sees them, the host can change them -->
      <div data-test="options-summary" class="rounded-lg border border-slate-600/70 px-3 py-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-semibold">{{ t('options.title') }}</span>
          <button v-if="host" data-test="open-options" class="btn btn-secondary px-3 py-1 text-sm" @click="optionsOpen = true">
            ⚙ {{ t('options.change') }}
          </button>
          <button v-else data-test="see-options" class="btn btn-ghost px-3 py-1 text-sm" @click="optionsOpen = true">{{ t('options.see') }}</button>
        </div>
        <p data-test="summary-goal" class="mt-1 text-sm text-slate-300">
          {{ view.settings.boardMode === 'custom' ? t('options.summaryCustom', { n: view.settings.goal }) : t('options.summaryGoal', { n: view.settings.goal }) }}
        </p>
        <ul class="mt-1 flex flex-wrap gap-1.5">
          <li
            v-for="kind in SPECIAL_KINDS"
            :key="kind"
            data-test="summary-special"
            :data-kind="kind"
            :title="t(`special.${kind}`)"
            class="flex items-center gap-1 rounded bg-slate-700/70 px-1.5 py-0.5 text-xs"
            :class="{ 'opacity-40': summaryCounts[kind] === 0 }"
          >
            <span class="flex h-4 w-6 items-center justify-center rounded border text-[9px] font-black" :class="SPECIAL_STYLE[kind].tile">{{
              SPECIAL_STYLE[kind].icon
            }}</span>
            <span class="font-mono font-bold">{{ summaryCounts[kind] }}</span>
          </li>
        </ul>
        <p data-test="summary-points" class="mt-1.5 text-xs" :class="isDefaultScoring(view.settings.scoring) ? 'text-slate-400' : 'font-semibold text-amber-200'">
          {{ isDefaultScoring(view.settings.scoring) ? t('options.pointsStandard') : t('options.pointsCustom') }}
        </p>
        <p data-test="summary-time" class="mt-0.5 text-xs" :class="timeLimited ? 'font-semibold text-amber-200' : 'text-slate-400'">
          {{ timeLimited ? t('options.summaryTime', { tip: timeLabel(view.settings.timers.tip), guess: timeLabel(view.settings.timers.guess) }) : t('options.summaryTimeNone') }}
        </p>
      </div>

      <template v-if="host">
        <button data-test="start" class="btn btn-primary" :disabled="!enough" @click="store.start()">{{ t('lobby.start') }}</button>
        <p v-if="!enough" class="text-center text-sm text-slate-400">{{ t('lobby.needPlayers') }}</p>
      </template>
      <p v-else data-test="waiting-host" class="text-center text-sm text-slate-300">{{ t('lobby.waitingHost', { name: hostName }) }}</p>

      <div class="flex flex-wrap justify-center gap-2">
        <button data-test="own-cards" class="btn btn-ghost text-sm" @click="ownCardsOpen = true">✎ {{ t('own.open') }}</button>
        <button data-test="leave" class="btn btn-ghost text-sm" @click="store.leave()">{{ t('lobby.leave') }}</button>
      </div>
    </section>

    <OwnCardsModal v-if="ownCardsOpen" @close="ownCardsOpen = false" />

    <GameOptionsModal v-if="optionsOpen" :store="store" :view="view" :readonly="!host" @close="optionsOpen = false" />
  </div>
</template>
