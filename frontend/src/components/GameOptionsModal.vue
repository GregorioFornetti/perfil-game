<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import BoardEditor from './BoardEditor.vue';
import { countKinds, randomBoard } from '../board';
import { SPECIAL_STYLE } from '../specials';
import type { GameStore } from '../store';
import {
  defaultScoring,
  defaultSpecialCounts,
  INDIVIDUAL_MAX_TIPS,
  MAX_POINTS,
  maxSpecialSpaces,
  TIMER_CHOICES,
  SPECIAL_KINDS,
  totalSpecials,
  TIPS_PER_CARD,
  type BoardMode,
  type GameView,
  type Scoring,
  type SpecialSpace,
  type SpecialCounts,
  type SpecialKind,
} from '../types';

/** readonly: the other players can look at the options without changing them. */
const props = defineProps<{ store: GameStore; view: GameView; readonly?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

const goal = ref(props.view.settings.goal);
const counts = reactive<SpecialCounts>({ ...props.view.settings.specials });
const busy = ref(false);
const tab = ref<'board' | 'points' | 'time'>('board');
const timers = reactive({ ...props.view.settings.timers });
const timeLabel = (seconds: number) => (seconds === 0 ? t('options.noLimit') : t('options.seconds', { n: seconds }));
const scoring = reactive<Scoring>(JSON.parse(JSON.stringify(props.view.settings.scoring)));
const tipRows = Array.from({ length: TIPS_PER_CARD }, (_, i) => i);
const individualRows = Array.from({ length: INDIVIDUAL_MAX_TIPS }, (_, i) => i);

/** Reads a typed score: a whole number from 0 to MAX_POINTS (anything else becomes the nearest one). */
function points(event: Event): number {
  const input = event.target as HTMLInputElement;
  const n = Math.floor(Number(input.value));
  const kept = Number.isFinite(n) ? Math.min(MAX_POINTS, Math.max(0, n)) : 0;
  input.value = String(kept); // show the value actually kept
  return kept;
}

function resetPoints() {
  Object.assign(scoring, defaultScoring());
}
const firstField = ref<HTMLSelectElement | null>(null);

// the usual sizes, plus whatever is set now if it is another one
const goals = computed(() => Array.from(new Set([30, 60, 100, 150, props.view.settings.goal])).sort((a, b) => a - b));
const defaults = computed(() => defaultSpecialCounts(goal.value));
const max = computed(() => maxSpecialSpaces(goal.value));
const used = computed(() => totalSpecials(counts));
const tooMany = computed(() => boardMode.value === 'random' && used.value > max.value);

/** A new board size always brings back the default special spaces for it. */
const boardMode = ref<BoardMode>(props.view.settings.boardMode);
const customBoard = ref<SpecialSpace[]>(props.view.settings.customBoard.map((s) => ({ ...s })));
const customCounts = computed(() => countKinds(customBoard.value));

function setGoal(value: number) {
  goal.value = value;
  Object.assign(counts, defaultSpecialCounts(value));
  // a board made for another size keeps the special spaces that still fit
  customBoard.value = customBoard.value.filter((s) => s.index < value);
}

/** Fills the board editor at random, with the default numbers of special spaces for this size. */
function fillAtRandom() {
  customBoard.value = randomBoard(goal.value, defaultSpecialCounts(goal.value));
}

const goalChoice = computed({ get: () => goal.value, set: (value: number) => setGoal(value) });

function resetCounts() {
  Object.assign(counts, defaults.value);
}

/** The most this kind can have without going over the room on the board. */
const limitFor = (kind: SpecialKind) => counts[kind] + Math.max(0, max.value - used.value);

function step(kind: SpecialKind, delta: number) {
  counts[kind] = Math.min(limitFor(kind), Math.max(0, counts[kind] + delta));
}

function typed(kind: SpecialKind, event: Event) {
  const input = event.target as HTMLInputElement;
  const n = Math.floor(Number(input.value));
  counts[kind] = Number.isFinite(n) ? Math.min(limitFor(kind), Math.max(0, n)) : 0;
  input.value = String(counts[kind]); // show the value actually kept
}

async function save() {
  if (tooMany.value || busy.value) return;
  busy.value = true;
  const reply = await props.store.configure({ goal: goal.value, specials: { ...counts }, scoring: JSON.parse(JSON.stringify(scoring)), timers: { ...timers },
    boardMode: boardMode.value,
    customBoard: customBoard.value.map((s) => ({ ...s })),
  });
  busy.value = false;
  if (reply.ok) emit('close');
}

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') emit('close');
};
onMounted(() => {
  window.addEventListener('keydown', onKey);
  firstField.value?.focus();
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <!-- the outer layer scrolls; the inner one centres the window but lets a tall one start at the top -->
  <div class="fixed inset-0 z-40 overflow-y-auto bg-black/70" @click.self="emit('close')">
    <div class="flex min-h-full items-center justify-center p-4" @click.self="emit('close')">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="options-title"
      data-test="options-modal"
      class="panel my-4 w-full max-w-xl border-slate-600 bg-slate-800"
    >
      <div class="mb-4 flex items-center justify-between">
        <h2 id="options-title" class="text-xl font-bold text-amber-300">{{ t('options.title') }}</h2>
        <button class="btn btn-ghost px-2 py-1 text-xl leading-none" :aria-label="t('options.cancel')" @click="emit('close')">×</button>
      </div>

      <div class="mb-4 flex gap-1 rounded-lg bg-slate-900/60 p-1" role="tablist">
        <button
          v-for="name in ['board', 'points', 'time'] as const"
          :key="name"
          role="tab"
          :data-test="`tab-${name}`"
          :aria-selected="tab === name"
          class="flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition"
          :class="tab === name ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'"
          @click="tab = name"
        >
          {{ t({ board: 'options.tabBoard', points: 'options.tabPoints', time: 'options.tabTime' }[name]) }}
        </button>
      </div>

      <div v-show="tab === 'board'" data-test="board-tab">
      <label class="flex items-center justify-between gap-3">
        <span class="font-medium">{{ t('options.goal') }}</span>
        <select
          ref="firstField"
          data-test="options-goal"
          class="field w-auto"
          :disabled="readonly"
          v-model.number="goalChoice"
        >
          <option v-for="g in goals" :key="g" :value="g">{{ g }}</option>
        </select>
      </label>
      <p class="mt-1 text-xs text-slate-400">{{ t('options.goalNote') }}</p>

      <h3 class="mt-5 font-bold">{{ t('options.boardHow') }}</h3>
      <div class="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" :aria-label="t('options.boardHow')">
        <label
          v-for="mode in ['random', 'custom'] as const"
          :key="mode"
          :data-test="`mode-${mode}`"
          class="flex cursor-pointer gap-2 rounded-lg border px-3 py-2"
          :class="boardMode === mode ? 'border-amber-300 bg-amber-400/10' : 'border-slate-600 bg-slate-700/40'"
        >
          <input v-model="boardMode" type="radio" name="board-mode" :value="mode" class="mt-1 accent-amber-400" :disabled="readonly" />
          <span>
            <span class="block text-sm font-semibold">{{ t(mode === 'random' ? 'options.modeRandom' : 'options.modeCustom') }}</span>
            <span class="block text-xs text-slate-400">{{ t(mode === 'random' ? 'options.modeRandomHint' : 'options.modeCustomHint') }}</span>
          </span>
        </label>
      </div>

      <!-- a board made by the host -->
      <div v-if="boardMode === 'custom'" data-test="custom-board" class="mt-4">
        <p v-if="!readonly" class="mb-2 text-xs text-slate-300">{{ t('options.editorHint') }}</p>
        <BoardEditor v-model:board="customBoard" :goal="goal" :readonly="readonly" />
        <div class="mt-3 flex flex-wrap items-center gap-1.5">
          <span
            v-for="kind in SPECIAL_KINDS"
            :key="kind"
            data-test="custom-count"
            :data-kind="kind"
            class="flex items-center gap-1 rounded bg-slate-700/70 px-1.5 py-0.5 text-xs"
            :class="{ 'opacity-40': customCounts[kind] === 0 }"
            :title="t(`special.${kind}`)"
          >
            <span class="flex h-4 w-6 items-center justify-center rounded border text-[9px] font-black" :class="SPECIAL_STYLE[kind].tile">{{
              SPECIAL_STYLE[kind].icon
            }}</span>
            <span class="font-mono font-bold">{{ customCounts[kind] }}</span>
          </span>
          <span data-test="custom-used" class="ml-auto text-xs text-slate-300">{{ t('options.used', { n: customBoard.length, max }) }}</span>
        </div>
        <div v-if="!readonly" class="mt-2 flex flex-wrap gap-3 text-xs">
          <button data-test="board-random-fill" class="text-sky-300 underline-offset-2 hover:underline" @click="fillAtRandom">{{ t('options.randomFill') }}</button>
          <button data-test="board-clear" class="text-sky-300 underline-offset-2 hover:underline" @click="customBoard = []">{{ t('options.clearBoard') }}</button>
        </div>
      </div>

      <div v-else>
      <div class="mt-5 flex items-baseline justify-between">
        <h3 class="font-bold">{{ t('options.specials') }}</h3>
        <button v-if="!readonly" data-test="options-reset" class="text-xs text-sky-300 underline-offset-2 hover:underline" @click="resetCounts">
          {{ t('options.reset') }}
        </button>
      </div>
      <ul class="mt-2 flex flex-col gap-2">
        <li v-for="kind in SPECIAL_KINDS" :key="kind" data-test="options-special" :data-kind="kind" class="flex items-center gap-3 rounded-lg bg-slate-700/50 px-3 py-2">
          <span class="flex h-7 w-9 shrink-0 items-center justify-center rounded border text-xs font-black" :class="SPECIAL_STYLE[kind].tile">{{
            SPECIAL_STYLE[kind].icon
          }}</span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-semibold">{{ t(`special.${kind}`) }}</span>
            <span class="block text-xs text-slate-400">{{ t('options.default', { n: defaults[kind] }) }}</span>
          </span>
          <span class="flex items-center gap-1">
            <button
              data-test="less"
              class="btn btn-secondary h-8 w-8 p-0"
              :disabled="readonly || counts[kind] <= 0"
              :aria-label="t('options.less', { name: t(`special.${kind}`) })"
              @click="step(kind, -1)"
            >
              −
            </button>
            <input
              data-test="count"
              type="number"
              inputmode="numeric"
              min="0"
              :max="limitFor(kind)"
              :disabled="readonly"
              class="field w-14 px-1 py-1 text-center tabular-nums"
              :value="counts[kind]"
              :aria-label="t(`special.${kind}`)"
              @change="typed(kind, $event)"
            />
            <button
              data-test="more"
              class="btn btn-secondary h-8 w-8 p-0"
              :disabled="readonly || used >= max"
              :aria-label="t('options.more', { name: t(`special.${kind}`) })"
              @click="step(kind, 1)"
            >
              +
            </button>
          </span>
        </li>
      </ul>
      <p data-test="options-used" class="mt-3 text-sm" :class="tooMany ? 'font-semibold text-rose-300' : used >= max ? 'text-amber-200' : 'text-slate-300'">
        {{ tooMany ? t('options.tooMany', { max }) : t('options.used', { n: used, max }) }}
      </p>
      </div>
      </div>

      <!-- how many spaces players move -->
      <div v-show="tab === 'points'" data-test="points-tab">
        <div class="flex items-baseline justify-between gap-2">
          <p class="text-sm text-slate-300">{{ t('options.pointsNote') }}</p>
          <button v-if="!readonly" data-test="points-reset" class="shrink-0 text-xs text-sky-300 underline-offset-2 hover:underline" @click="resetPoints">
            {{ t('options.resetPoints') }}
          </button>
        </div>

        <h3 class="mt-3 font-bold">{{ t('options.pointsNormal') }}</h3>
        <table class="mt-1 w-full text-sm">
          <thead>
            <tr class="text-left text-xs text-slate-400">
              <th class="py-1 font-medium">{{ t('options.tipsShown') }}</th>
              <th class="py-1 font-medium">{{ t('options.guesser') }}</th>
              <th class="py-1 font-medium">{{ t('options.holder') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in tipRows" :key="i" data-test="points-row" class="border-t border-slate-700/70">
              <td class="py-1 font-mono">{{ i + 1 }}</td>
              <td class="py-1">
                <input
                  data-test="points-guesser"
                  type="number"
                  min="0"
                  :max="MAX_POINTS"
                  class="field w-20 px-2 py-1 tabular-nums"
                  :value="scoring.guesser[i]"
                  :disabled="readonly"
                  :aria-label="`${t('options.guesser')}, ${i + 1}`"
                  @change="scoring.guesser[i] = points($event)"
                />
              </td>
              <td class="py-1">
                <input
                  data-test="points-holder"
                  type="number"
                  min="0"
                  :max="MAX_POINTS"
                  class="field w-20 px-2 py-1 tabular-nums"
                  :value="scoring.holder[i]"
                  :disabled="readonly"
                  :aria-label="`${t('options.holder')}, ${i + 1}`"
                  @change="scoring.holder[i] = points($event)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <label class="mt-3 flex items-center justify-between gap-3 text-sm">
          <span>{{ t('options.nobody') }}</span>
          <input
            data-test="points-nobody"
            type="number"
            min="0"
            :max="MAX_POINTS"
            class="field w-20 shrink-0 px-2 py-1 tabular-nums"
            :value="scoring.nobody"
            :disabled="readonly"
            @change="scoring.nobody = points($event)"
          />
        </label>

        <h3 class="mt-5 font-bold">{{ t('options.pointsIndividual') }}</h3>
        <table class="mt-1 w-full text-sm">
          <thead>
            <tr class="text-left text-xs text-slate-400">
              <th class="py-1 font-medium">{{ t('options.tipsShown') }}</th>
              <th class="py-1 font-medium">{{ t('options.answering') }}</th>
              <th class="py-1 font-medium">{{ t('options.holder') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in individualRows" :key="i" class="border-t border-slate-700/70">
              <td class="py-1 font-mono">{{ i + 1 }}</td>
              <td class="py-1">
                <input
                  data-test="points-individual"
                  type="number"
                  min="0"
                  :max="MAX_POINTS"
                  class="field w-20 px-2 py-1 tabular-nums"
                  :value="scoring.individual[i]"
                  :disabled="readonly"
                  :aria-label="`${t('options.answering')}, ${i + 1}`"
                  @change="scoring.individual[i] = points($event)"
                />
              </td>
              <td class="py-1 text-slate-500">0</td>
            </tr>
          </tbody>
        </table>
        <p class="mt-2 text-xs text-slate-400">{{ t('options.individualNote') }}</p>
      </div>

      <!-- time limits -->
      <div v-show="tab === 'time'" data-test="time-tab" class="flex flex-col gap-3">
        <label class="flex items-center justify-between gap-3">
          <span class="font-medium">{{ t('options.timeTip') }}</span>
          <select v-model.number="timers.tip" data-test="time-tip" class="field w-auto" :disabled="readonly">
            <option v-for="s in TIMER_CHOICES" :key="s" :value="s">{{ timeLabel(s) }}</option>
          </select>
        </label>
        <label class="flex items-center justify-between gap-3">
          <span class="font-medium">{{ t('options.timeGuess') }}</span>
          <select v-model.number="timers.guess" data-test="time-guess" class="field w-auto" :disabled="readonly">
            <option v-for="s in TIMER_CHOICES" :key="s" :value="s">{{ timeLabel(s) }}</option>
          </select>
        </label>
        <p class="text-xs text-slate-400">{{ t('options.timeNote') }}</p>
      </div>

      <div class="mt-5 flex flex-wrap justify-end gap-2">
        <button v-if="readonly" data-test="options-cancel" class="btn btn-secondary" @click="emit('close')">{{ t('options.close') }}</button>
        <template v-else>
          <button data-test="options-cancel" class="btn btn-ghost" @click="emit('close')">{{ t('options.cancel') }}</button>
          <button data-test="options-save" class="btn btn-primary" :disabled="tooMany || busy" @click="save">{{ t('options.save') }}</button>
        </template>
      </div>
    </div>
  </div>
  </div>
</template>
