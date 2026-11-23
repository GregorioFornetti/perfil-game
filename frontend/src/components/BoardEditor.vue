<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { boardCells, editorColumnsFor, nextKind } from '../board';
import { SPECIAL_STYLE } from '../specials';
import type { SpecialKind, SpecialSpace } from '../types';

/** A copy of the board where the host places special spaces: each click turns a space into the next kind. */
const props = defineProps<{ goal: number; board: SpecialSpace[]; readonly?: boolean }>();
const emit = defineEmits<{ 'update:board': [board: SpecialSpace[]] }>();
const { t } = useI18n();

// fewer, larger spaces per row on a small screen (the options window is narrower than the game board)
const width = ref(window.innerWidth);
const onResize = () => (width.value = window.innerWidth);
onMounted(() => window.addEventListener('resize', onResize));
onBeforeUnmount(() => window.removeEventListener('resize', onResize));
const cols = computed(() => editorColumnsFor(width.value, props.goal));
const cells = computed(() => boardCells(props.goal, cols.value));
const kindAt = (index: number) => props.board.find((s) => s.index === index)?.kind;

function toggle(index: number) {
  if (props.readonly || index <= 0 || index >= props.goal) return;
  const next = nextKind(kindAt(index));
  const others = props.board.filter((s) => s.index !== index);
  emit('update:board', (next ? [...others, { index, kind: next }] : others).sort((a, b) => a.index - b.index));
}

const label = (index: number, kind: SpecialKind | undefined) =>
  t('options.space', { n: index, kind: kind ? t(`special.${kind}`) : t('options.normal') });

const linkClass = {
  left: 'left-0 top-1/2 h-1 w-1/2 -translate-y-1/2',
  right: 'right-0 top-1/2 h-1 w-1/2 -translate-y-1/2',
  up: 'left-1/2 top-0 h-1/2 w-1 -translate-x-1/2',
  down: 'bottom-0 left-1/2 h-1/2 w-1 -translate-x-1/2',
};
</script>

<template>
  <div data-test="board-editor" class="grid" :style="{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }">
    <div
      v-for="cell in cells"
      :key="cell.index"
      class="relative aspect-square"
      :style="{ gridRow: cell.row + 1, gridColumn: cell.col + 1 }"
    >
      <span v-for="side in cell.links" :key="side" class="absolute bg-slate-500" :class="linkClass[side]"></span>
      <div
        v-if="cell.index === 0 || cell.index === goal"
        data-test="editor-end"
        class="absolute inset-[2px] flex items-center justify-center rounded-md border text-sm sm:inset-[3px]"
        :class="cell.index === 0 ? 'border-emerald-400/70 bg-emerald-700 text-emerald-100' : 'border-amber-300 bg-amber-500'"
        :title="cell.index === 0 ? t('game.start') : t('game.finish')"
      >
        {{ cell.index === 0 ? '➜' : '🏁' }}
      </div>
      <button
        v-else
        type="button"
        data-test="editor-space"
        :data-index="cell.index"
        :data-kind="kindAt(cell.index)"
        :disabled="readonly"
        :aria-label="label(cell.index, kindAt(cell.index))"
        :title="label(cell.index, kindAt(cell.index))"
        class="absolute inset-[2px] flex items-center justify-center rounded-md border text-[10px] transition enabled:cursor-pointer enabled:hover:brightness-125 disabled:cursor-default sm:inset-[3px]"
        :class="kindAt(cell.index) ? SPECIAL_STYLE[kindAt(cell.index)!].tile : 'border-slate-600 bg-slate-700 text-slate-400'"
        @click="toggle(cell.index)"
      >
        <span class="absolute left-0.5 top-0 text-[8px] opacity-70">{{ cell.index }}</span>
        <span v-if="kindAt(cell.index)" class="text-sm font-black sm:text-xs">{{ SPECIAL_STYLE[kindAt(cell.index)!].icon }}</span>
      </button>
    </div>
  </div>
</template>
