<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import PlayerToken from './PlayerToken.vue';
import { individualPointsParams, specialAt } from '../game';
import { SPECIAL_STYLE } from '../specials';
import { SPECIAL_KINDS } from '../types';
import { boardCells, columnsFor, DEFAULT_SPACE, rowCount, tokenPlaces, type SpaceSize } from '../board';
import type { GameView } from '../types';

const props = defineProps<{ view: GameView }>();
const { t } = useI18n();

const track = ref<HTMLElement | null>(null);
const width = ref(window.innerWidth);
const space = ref<SpaceSize>(DEFAULT_SPACE);

const cols = computed(() => columnsFor(width.value, props.view.goal));
const rows = computed(() => rowCount(props.view.goal, cols.value));
const cells = computed(() => boardCells(props.view.goal, cols.value));
const tokens = computed(() => tokenPlaces(props.view.players, props.view.goal, cols.value, space.value));

/** Measures a space and a token on the screen, so that tokens sharing a space are kept inside it. */
async function measure() {
  width.value = window.innerWidth;
  await nextTick();
  const cell = track.value?.querySelector('[data-test="space"]')?.getBoundingClientRect();
  const token = track.value?.parentElement?.querySelector('[data-test="token"]')?.getBoundingClientRect();
  if (cell?.width && token?.width) space.value = { width: cell.width - 6, height: cell.height - 6, token: token.width };
}
onMounted(() => {
  window.addEventListener('resize', measure);
  void measure();
});
onBeforeUnmount(() => window.removeEventListener('resize', measure));
watch(() => props.view.goal, measure);

const percent = (fraction: number) => `${Number((fraction * 100).toFixed(3))}%`;

const present = computed(() => SPECIAL_KINDS.filter((k) => props.view.specials.some((s) => s.kind === k)));

function tileClass(index: number): string {
  if (index === 0) return 'items-center justify-center border-emerald-400/70 bg-emerald-700 text-emerald-100';
  if (index === props.view.goal) return 'items-center justify-center border-amber-300 bg-amber-500 text-slate-900';
  const special = specialAt(props.view, index);
  if (special) return `items-center justify-center ${SPECIAL_STYLE[special].tile}`;
  if (index % 5 === 0) return 'items-start border-slate-400/60 bg-slate-600 text-slate-200';
  return 'items-start border-slate-600 bg-slate-700 text-slate-400';
}

function tileTitle(index: number): string {
  if (index === 0) return t('game.start');
  if (index === props.view.goal) return t('game.finish');
  const special = specialAt(props.view, index);
  return special ? `${index} – ${t(`special.${special}`)}: ${t(`specialHelp.${special}`, individualPointsParams(props.view))}` : String(index);
}

const linkClass = {
  left: 'left-0 top-1/2 h-1 w-1/2 -translate-y-1/2',
  right: 'right-0 top-1/2 h-1 w-1/2 -translate-y-1/2',
  up: 'left-1/2 top-0 h-1/2 w-1 -translate-x-1/2',
  down: 'bottom-0 left-1/2 h-1/2 w-1 -translate-x-1/2',
};
</script>

<template>
  <section class="panel" data-test="board">
    <div class="mb-3 flex items-baseline justify-between">
      <h2 class="text-lg font-bold">{{ t('game.board') }}</h2>
      <span class="text-xs text-slate-400">{{ t('game.goal', { n: view.goal }) }}</span>
    </div>

    <div class="relative">
      <!-- the track -->
      <div ref="track" class="grid" :style="{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }">
        <div
          v-for="cell in cells"
          :key="cell.index"
          data-test="space"
          class="relative aspect-square"
          :style="{ gridRow: cell.row + 1, gridColumn: cell.col + 1 }"
        >
          <span v-for="side in cell.links" :key="side" class="absolute bg-slate-500" :class="linkClass[side]"></span>
          <div
            class="absolute inset-[3px] flex rounded-md border px-1 text-[9px] leading-tight sm:inset-1 sm:text-[10px]"
            :class="tileClass(cell.index)"
            :title="tileTitle(cell.index)"
            :data-special="specialAt(view, cell.index)"
          >
            <span v-if="cell.index === 0" class="text-base font-bold sm:text-lg">➜</span>
            <span v-else-if="cell.index === view.goal" class="text-base sm:text-xl">🏁</span>
            <template v-else-if="specialAt(view, cell.index)">
              <span class="absolute left-1 top-0 opacity-80">{{ cell.index }}</span>
              <span class="text-xs font-black sm:text-base">{{ SPECIAL_STYLE[specialAt(view, cell.index)!].icon }}</span>
            </template>
            <span v-else>{{ cell.index }}</span>
          </div>
        </div>
      </div>

      <!-- the players' tokens, laid over the track so that they slide from space to space -->
      <div class="pointer-events-none absolute inset-0">
        <div
          v-for="place in tokens"
          :key="place.player.id"
          data-test="board-token"
          :data-space="Math.min(view.goal, place.player.position)"
          class="pointer-events-auto absolute transition-all duration-700 ease-in-out"
          :class="[place.player.id === view.you ? 'z-20' : 'z-10', place.player.connected ? '' : 'opacity-50']"
          :style="{
            left: percent((place.col + 0.5) / cols),
            top: percent((place.row + 0.5) / rows),
            transform: `translate(calc(-50% + ${place.dx}px), calc(-50% + ${place.dy}px))`,
          }"
        >
          <PlayerToken :name="place.player.name" :color="place.player.color" :highlight="place.player.id === view.you" />
        </div>
      </div>
    </div>

    <!-- what the special spaces do -->
    <div v-if="present.length" data-test="legend" class="mt-4 border-t border-slate-700 pt-3">
      <ul class="grid gap-x-6 gap-y-1.5 text-xs text-slate-300 sm:grid-cols-2 xl:grid-cols-3">
        <li v-for="kind in present" :key="kind" :data-kind="kind" class="flex items-start gap-2">
          <span class="flex h-5 w-7 shrink-0 items-center justify-center rounded border text-[10px] font-black" :class="SPECIAL_STYLE[kind].tile">{{
            SPECIAL_STYLE[kind].icon
          }}</span>
          <span
            ><b class="text-slate-100">{{ t(`special.${kind}`) }}</b> – {{ t(`specialHelp.${kind}`, individualPointsParams(view)) }}</span
          >
        </li>
      </ul>
      <p class="mt-2 text-xs text-slate-400">{{ t('game.specialsNote') }}</p>
    </div>
  </section>
</template>
