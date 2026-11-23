<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import GameBoard from './GameBoard.vue';
import GuessLog from './GuessLog.vue';
import OwnCardsModal from './OwnCardsModal.vue';
import ScoreBoard from './ScoreBoard.vue';
import TipList from './TipList.vue';
import TurnTimer from './TurnTimer.vue';
import {
  canGuess,
  canSkipIndividual,
  canStartNextRound,
  guessWorth,
  individualPointsParams,
  isHolder,
  isHost,
  isIndividual,
  isMyTurn,
  playerById,
} from '../game';
import type { GameStore } from '../store';
import { MAX_GUESS_LENGTH, type GameView, type OwnCard, type SpecialEffectView } from '../types';

const props = defineProps<{ store: GameStore; view: GameView }>();
const { t } = useI18n();

const guessText = ref('');
const guessInput = ref<HTMLInputElement | null>(null);

const round = computed(() => props.view.round);
const result = computed(() => props.view.result);
const over = computed(() => props.view.phase === 'roundEnd' || props.view.phase === 'finished');
const holder = computed(() => isHolder(props.view));
/** The card holder may put the card aside and draw another, until the first tip is shown. */
const ownCardsOpen = ref(false);
async function playOwnCard(card: OwnCard) {
  const reply = await props.store.useOwnCard(card);
  if (reply.ok) ownCardsOpen.value = false;
}
const cardChosen = computed(() => props.view.round?.cardChosen ?? true);
const canSkipCard = computed(
  () => holder.value && !cardChosen.value && props.view.phase === 'choosing' && props.view.round?.revealed.length === 0,
);
const name = (id: string | null | undefined) => playerById(props.view, id)?.name ?? t('game.someone');

const status = computed(() => {
  const v = props.view;
  if (!v.round || over.value) return '';
  // first the card holder settles on the card
  if (!v.round.cardChosen) {
    return isHolder(v) ? t('game.status.youChooseCard') : t('game.status.waitingCard', { name: name(v.round.holderId) });
  }
  if (!playerById(v, v.round.turnId)?.connected) return t('game.status.waiting');
  const who = { name: name(v.round.turnId) };
  if (isIndividual(v)) {
    const used = { n: v.round.revealed.length };
    if (!isMyTurn(v)) return t('game.individual.other', { ...who, ...used });
    return v.phase === 'choosing' ? t('game.individual.youChoose', used) : t('game.status.youGuess');
  }
  if (v.phase === 'choosing') return isMyTurn(v) ? t('game.status.youChoose') : t('game.status.otherChooses', who);
  return isMyTurn(v) ? t('game.status.youGuess') : t('game.status.otherGuesses', who);
});

const headline = computed(() => {
  const r = result.value;
  if (!r) return '';
  if (r.kind === 'individual') {
    const who = name(r.solverId);
    if (r.reason === 'guessed') return t('game.result.individualGuessed', { name: who, n: r.tipsUsed }, r.tipsUsed);
    if (r.reason === 'solverLeft') return t('game.result.solverLeft', { name: who });
    return t('game.result.individualMissed', { name: who });
  }
  if (r.reason === 'guessed') return t('game.result.guessed', { name: name(r.winnerId), n: r.tipsUsed }, r.tipsUsed);
  return t(`game.result.${r.reason}`);
});

const moves = computed(() => {
  const r = result.value;
  if (!r) return [];
  const list: string[] = [];
  if (r.winnerId && r.guesserPoints > 0) list.push(t('game.result.moves', { name: name(r.winnerId), n: r.guesserPoints }, r.guesserPoints));
  if (r.holderPoints > 0) list.push(t('game.result.moves', { name: name(r.holderId), n: r.holderPoints }, r.holderPoints));
  return list;
});

/** What the special spaces did at the end of the round. */
const effects = computed(() =>
  (result.value?.effects ?? []).map((e: SpecialEffectView) => ({
    kind: e.kind,
    text: t(`game.result.effect.${e.kind}`, { name: name(e.playerId), from: e.from, to: e.to }),
  })),
);

/** The next individual question waiting to be played, if any. */
const nextSolver = computed(() => props.view.pendingIndividual[0] ?? null);

// put the cursor in the guess box as soon as it is our turn to guess
watch(
  () => canGuess(props.view),
  async (can) => {
    if (!can) return;
    guessText.value = '';
    await nextTick();
    guessInput.value?.focus();
  },
);

async function submitGuess() {
  const text = guessText.value.trim();
  if (!text) return;
  const reply = await props.store.guess(text);
  if (reply.ok) guessText.value = '';
}
</script>

<template>
  <div v-if="round" class="flex flex-col gap-6">
  <GameBoard :view="view" />
  <div class="grid gap-6 lg:grid-cols-[1fr_20rem]">
    <div class="flex flex-col gap-6">
      <!-- end of the game -->
      <section v-if="view.phase === 'finished'" data-test="finished" class="panel border-amber-400/60 text-center">
        <p class="text-5xl">🏆</p>
        <h2 class="mt-2 text-3xl font-black text-amber-300">
          {{ view.winnerId === view.you ? t('game.finished.youWin') : t('game.finished.title', { name: name(view.winnerId) }) }}
        </h2>
        <button v-if="isHost(view)" data-test="again" class="btn btn-primary mt-4" @click="store.playAgain()">{{ t('game.finished.again') }}</button>
        <p v-else class="mt-4 text-sm text-slate-300">{{ t('game.finished.waitingAgain', { name: name(view.hostId) }) }}</p>
      </section>

      <!-- end of the round -->
      <section v-if="over && result" data-test="result" class="panel text-center">
        <h2 class="text-2xl font-extrabold">{{ headline }}</h2>
        <p class="mt-3 text-sm uppercase tracking-widest text-slate-400">{{ t('game.result.answer') }}</p>
        <p data-test="answer" class="text-4xl font-black text-amber-300">{{ result.answer }}</p>
        <ul class="mt-3 text-slate-200">
          <li v-for="line in moves" :key="line" data-test="move">{{ line }}</li>
        </ul>
        <ul v-if="effects.length" class="mt-3 flex flex-col items-center gap-1.5">
          <li
            v-for="e in effects"
            :key="e.text"
            data-test="effect"
            :data-kind="e.kind"
            class="rounded-lg px-3 py-1.5 text-sm font-semibold"
            :class="{
              'bg-violet-600/40 text-violet-100': e.kind === 'individual',
              'bg-rose-700/50 text-rose-100': e.kind === 'back',
              'bg-emerald-600/40 text-emerald-100': e.kind === 'forward',
              'bg-black/60 text-slate-100': e.kind === 'dead',
              'bg-yellow-400/30 text-yellow-100': e.kind === 'win',
            }"
          >
            {{ e.text }}
          </li>
        </ul>
        <template v-if="view.phase === 'roundEnd'">
          <p v-if="nextSolver" data-test="upcoming" class="mt-4 text-sm text-violet-200">
            {{ t('game.result.upcoming', { name: name(nextSolver) }) }}
          </p>
          <button v-if="canStartNextRound(view)" data-test="next" class="btn btn-primary mt-4" @click="store.nextRound()">
            {{ nextSolver ? t('game.result.nextIndividual', { name: name(nextSolver) }) : t('game.result.next') }}
          </button>
          <p v-else class="mt-4 text-sm text-slate-300">{{ t('game.result.waitingNext', { name: name(view.hostId) }) }}</p>
        </template>
      </section>

      <!-- the card -->
      <section class="panel">
        <div class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span v-if="round.kind === 'individual'" data-test="round-badge" class="rounded-full bg-violet-600 px-3 py-1 text-sm font-bold text-white"
            >❓ {{ t('game.individual.badge') }}</span
          >
          <span v-else data-test="round-badge" class="rounded-full bg-indigo-500/40 px-3 py-1 text-sm font-bold text-indigo-100">{{
            t('game.round', { n: round.number })
          }}</span>
          <span data-test="category" class="rounded-full bg-amber-400 px-3 py-1 text-sm font-bold text-slate-900">{{ t(`iAm.${round.category}`) }}</span>
          <span data-test="holder" class="text-sm text-slate-300">🃏 {{ holder ? t('game.youHold') : t('game.holder', { name: name(round.holderId) }) }}</span>
          <span class="ml-auto text-sm text-slate-400">{{
            round.kind === 'individual' ? t('game.individual.tipsShown', { n: round.revealed.length }) : t('game.tipsShown', { n: round.revealed.length })
          }}</span>
        </div>

        <p v-if="round.kind === 'individual' && !over" data-test="individual-about" class="mb-4 rounded-xl bg-violet-600/25 px-4 py-3 text-sm text-violet-100">
          {{ t('game.individual.about', { name: name(round.turnId ?? view.result?.solverId), ...individualPointsParams(view) }) }}
        </p>

        <div v-if="holder && !over" data-test="secret" class="mb-4 rounded-xl border border-amber-400/50 bg-amber-400/10 p-4 text-center">
          <p class="text-xs uppercase tracking-widest text-amber-200">{{ t('game.secret') }}</p>
          <p class="text-3xl font-black text-amber-300">{{ round.answer }}</p>
          <p class="mt-1 text-xs text-slate-400">{{ t('game.keepSecret') }}</p>
          <div v-if="canSkipCard" class="mt-3 border-t border-amber-400/30 pt-3">
            <div class="flex flex-wrap justify-center gap-2">
              <button data-test="choose-card" class="btn btn-primary px-4 py-1.5" @click="store.chooseCard()">✓ {{ t('game.chooseCard') }}</button>
              <button data-test="skip-card" class="btn btn-secondary px-3 py-1.5 text-sm" @click="store.skipCard()">⟳ {{ t('game.skipCard') }}</button>
              <button data-test="own-cards" class="btn btn-secondary px-3 py-1.5 text-sm" @click="ownCardsOpen = true">✎ {{ t('own.open') }}</button>
            </div>
            <p class="mt-1 text-xs text-slate-400">{{ t('game.skipCardHint') }}</p>
          </div>
        </div>
        <p v-if="round.ownCard" data-test="own-note" class="mb-4 text-xs text-slate-400">✎ {{ t('own.note', { name: name(round.holderId) }) }}</p>
        <p v-if="round.skipped > 0 && !over" data-test="skipped-note" class="mb-4 text-xs text-slate-400">
          ⟳ {{ t('game.skipped', { name: name(round.holderId), n: round.skipped }, round.skipped) }}
        </p>

        <div v-if="!over" class="mb-4 rounded-xl px-4 py-3" :class="isMyTurn(view) && cardChosen ? 'bg-emerald-500/20 text-emerald-100' : 'bg-slate-700/60 text-slate-200'">
          <p data-test="status" class="font-semibold">{{ status }}</p>
          <p v-if="!holder && cardChosen && (!isIndividual(view) || isMyTurn(view))" class="text-xs opacity-80">{{ t('game.worthNow', { n: guessWorth(view) }) }}</p>

          <TurnTimer v-if="round.timer" :timer="round.timer" />
          <p v-if="round.timedOut" data-test="timed-out" class="mt-2 text-xs font-semibold text-amber-200">
            ⏱ {{ t(`game.timedOut.${round.timedOut.action}`, { name: name(round.timedOut.playerId) }) }}
          </p>

          <button v-if="canSkipIndividual(view)" data-test="skip" class="btn btn-secondary mt-3 text-sm" @click="store.skipIndividual()">
            {{ t('game.individual.skip', { name: name(round.turnId) }) }}
          </button>

          <form v-if="canGuess(view)" class="mt-3 flex flex-wrap gap-2" @submit.prevent="submitGuess">
            <input
              ref="guessInput"
              v-model="guessText"
              data-test="guess-input"
              class="field min-w-40 flex-1"
              :maxlength="MAX_GUESS_LENGTH"
              :placeholder="t('game.guessPlaceholder')"
              autocomplete="off"
            />
            <button data-test="guess" type="submit" class="btn btn-primary" :disabled="!guessText.trim()">{{ t('game.guess') }}</button>
            <button data-test="pass" type="button" class="btn btn-secondary" @click="store.pass()">{{ t('game.pass') }}</button>
          </form>
        </div>

        <TipList :view="view" @pick="store.chooseTip($event)" />
      </section>
    </div>

    <OwnCardsModal v-if="ownCardsOpen && canSkipCard" can-use @close="ownCardsOpen = false" @use="playOwnCard" />

    <aside class="flex flex-col gap-6">
      <ScoreBoard :view="view" />
      <GuessLog :view="view" @accept="store.acceptGuess($event)" />
      <button data-test="leave" class="btn btn-ghost self-center text-sm" @click="store.leave()">{{ t('game.leave') }} ({{ view.code }})</button>
    </aside>
  </div>
  </div>
</template>
