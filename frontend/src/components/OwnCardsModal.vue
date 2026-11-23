<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { generateCard, generatorAvailable } from '../cardGenerator';
import { blankCard, filledTips, isBlank, isComplete, readMyCards, toOwnCard, writeMyCards, type MyCard } from '../myCards';
import { CATEGORIES, MAX_ANSWER_LENGTH, MAX_TIP_LENGTH, type OwnCard } from '../types';

/**
 * The cards the player wrote: a list to pick from, and a form to write or change one.
 * canUse: the player is choosing the card of a round, so a finished card can be played.
 */
const props = defineProps<{ canUse?: boolean }>();
const emit = defineEmits<{ close: []; use: [card: OwnCard] }>();
const { t, te, locale } = useI18n();

const cards = ref<MyCard[]>(readMyCards(localStorage));
/** The card open in the form, if any (one of the cards of the list). */
const editing = ref<MyCard | null>(null);
const deleting = ref<string | null>(null);

// ---- filling the form with the server's AI service
const canGenerate = ref(false);
const generating = ref(false);
const confirmReplace = ref(false);
const generateMessage = ref<{ text: string; good: boolean } | null>(null);
onMounted(async () => (canGenerate.value = await generatorAvailable()));

async function fillAutomatically() {
  const card = editing.value;
  if (!card || generating.value) return;
  // the tips already written would be replaced: ask once more
  if (filledTips(card) > 0 && !confirmReplace.value) {
    confirmReplace.value = true;
    return;
  }
  confirmReplace.value = false;
  generating.value = true;
  generateMessage.value = null;
  const reply = await generateCard(card.category, card.answer, locale.value);
  generating.value = false;
  if (editing.value?.id !== card.id) return; // the player moved on meanwhile
  if (!reply.ok) {
    const key = te(`own.genErrors.${reply.code}`) ? `own.genErrors.${reply.code}` : 'own.genErrors.providerError';
    generateMessage.value = { text: t(key), good: false };
    return;
  }
  card.answer = reply.card.answer;
  card.aliases = reply.card.aliases.join(', ');
  card.tips = Array.from({ length: card.tips.length }, (_, i) => reply.card.tips[i] ?? '');
  generateMessage.value = reply.complete
    ? { text: t('own.generated'), good: true }
    : { text: t('own.generatedPartial', { n: reply.card.tips.length }), good: false };
}

watch(editing, () => {
  confirmReplace.value = false;
  generateMessage.value = null;
});

// everything typed is saved at once: twenty tips are too many to lose
watch(cards, (list) => writeMyCards(localStorage, list), { deep: true });

function create() {
  const card = blankCard();
  cards.value.push(card);
  editing.value = cards.value[cards.value.length - 1];
}

function backToList() {
  // a card left completely empty is not kept
  if (editing.value && isBlank(editing.value)) cards.value = cards.value.filter((c) => c.id !== editing.value?.id);
  editing.value = null;
}

function remove(card: MyCard) {
  if (deleting.value !== card.id) {
    deleting.value = card.id; // ask once more
    return;
  }
  cards.value = cards.value.filter((c) => c.id !== card.id);
  deleting.value = null;
}

function use(card: MyCard) {
  if (props.canUse && isComplete(card)) emit('use', toOwnCard(card));
}

function close() {
  backToList();
  emit('close');
}

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') close();
};
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="fixed inset-0 z-40 overflow-y-auto bg-black/70" @click.self="close">
    <div class="flex min-h-full items-center justify-center p-4" @click.self="close">
      <div role="dialog" aria-modal="true" aria-labelledby="own-title" data-test="own-modal" class="panel my-4 w-full max-w-xl border-slate-600 bg-slate-800">
        <div class="mb-3 flex items-center justify-between">
          <h2 id="own-title" class="text-xl font-bold text-amber-300">✎ {{ t('own.title') }}</h2>
          <button class="btn btn-ghost px-2 py-1 text-xl leading-none" :aria-label="t('own.close')" @click="close">×</button>
        </div>

        <!-- the list -->
        <template v-if="!editing">
          <p class="text-sm text-slate-300">{{ t('own.intro') }}</p>
          <p v-if="cards.length === 0" data-test="own-empty" class="mt-4 rounded-lg bg-slate-700/40 px-3 py-4 text-center text-sm text-slate-400">
            {{ t('own.empty') }}
          </p>
          <ul v-else class="mt-4 flex flex-col gap-2">
            <li v-for="card in cards" :key="card.id" data-test="own-card" class="flex flex-wrap items-center gap-2 rounded-lg bg-slate-700/50 px-3 py-2">
              <span class="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-slate-900">{{ t(`category.${card.category}`) }}</span>
              <span class="min-w-0 flex-1">
                <span class="block truncate font-semibold" :class="{ 'italic text-slate-400': !card.answer.trim() }">{{
                  card.answer.trim() || t('own.untitled')
                }}</span>
                <span class="block text-xs" :class="isComplete(card) ? 'text-emerald-300' : 'text-slate-400'">{{
                  t('own.tipsFilled', { n: filledTips(card) })
                }}</span>
              </span>
              <button
                v-if="canUse"
                data-test="own-use"
                class="btn btn-primary px-3 py-1 text-sm"
                :disabled="!isComplete(card)"
                :title="isComplete(card) ? '' : t('own.incomplete')"
                @click="use(card)"
              >
                {{ t('own.use') }}
              </button>
              <button data-test="own-edit" class="btn btn-secondary px-3 py-1 text-sm" @click="editing = card">{{ t('own.edit') }}</button>
              <button
                data-test="own-delete"
                class="btn px-3 py-1 text-sm"
                :class="deleting === card.id ? 'bg-rose-600 text-white hover:bg-rose-500' : 'btn-ghost'"
                @click="remove(card)"
                @blur="deleting = null"
              >
                {{ deleting === card.id ? t('own.confirmDelete') : t('own.delete') }}
              </button>
            </li>
          </ul>
          <div class="mt-5 flex flex-wrap justify-between gap-2">
            <button data-test="own-new" class="btn btn-secondary" @click="create">＋ {{ t('own.new') }}</button>
            <button data-test="own-close" class="btn btn-ghost" @click="close">{{ t('own.close') }}</button>
          </div>
        </template>

        <!-- the form -->
        <form v-else data-test="own-form" class="flex flex-col gap-3" @submit.prevent="backToList">
          <div class="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <label class="flex flex-col gap-1">
              <span class="text-sm font-medium text-slate-300">{{ t('own.category') }}</span>
              <select v-model="editing.category" data-test="own-category" class="field">
                <option v-for="c in CATEGORIES" :key="c" :value="c">{{ t(`category.${c}`) }}</option>
              </select>
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-sm font-medium text-slate-300">{{ t('own.answer') }}</span>
              <input v-model="editing.answer" data-test="own-answer" class="field" :maxlength="MAX_ANSWER_LENGTH" :placeholder="t('own.answerPlaceholder')" autocomplete="off" />
            </label>
          </div>
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium text-slate-300">{{ t('own.aliases') }}</span>
            <input v-model="editing.aliases" data-test="own-aliases" class="field" maxlength="500" :placeholder="t('own.aliasesPlaceholder')" autocomplete="off" />
          </label>

          <div v-if="canGenerate" class="rounded-lg border border-violet-400/40 bg-violet-500/10 px-3 py-2">
            <div class="flex flex-wrap items-center gap-2">
              <button
                data-test="own-generate"
                type="button"
                class="btn px-3 py-1.5 text-sm"
                :class="confirmReplace ? 'bg-rose-600 text-white hover:bg-rose-500' : 'bg-violet-500 text-white hover:bg-violet-400'"
                :disabled="generating"
                @click="fillAutomatically"
                @blur="confirmReplace = false"
              >
                {{ generating ? t('own.generating') : confirmReplace ? t('own.replaceTips') : `✨ ${t('own.generate')}` }}
              </button>
              <span class="text-xs text-slate-300">{{ t('own.generateHint') }}</span>
            </div>
            <p v-if="generateMessage" data-test="own-generate-message" class="mt-1.5 text-xs font-semibold" :class="generateMessage.good ? 'text-emerald-300' : 'text-amber-200'">
              {{ generateMessage.text }}
            </p>
          </div>

          <div class="flex items-baseline justify-between">
            <h3 class="font-bold">{{ t('own.tips') }}</h3>
            <span data-test="own-progress" class="text-xs" :class="isComplete(editing) ? 'text-emerald-300' : 'text-slate-400'">{{
              t('own.tipsFilled', { n: filledTips(editing) })
            }}</span>
          </div>
          <ol class="flex flex-col gap-1.5">
            <li v-for="(_, i) in editing.tips" :key="i" class="flex items-center gap-2">
              <span
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                :class="editing.tips[i].trim() ? 'bg-emerald-400 text-slate-900' : 'bg-slate-600 text-slate-300'"
                >{{ i + 1 }}</span
              >
              <input
                v-model="editing.tips[i]"
                data-test="own-tip"
                class="field py-1.5 text-sm"
                :maxlength="MAX_TIP_LENGTH"
                :aria-label="t('own.tip', { n: i + 1 })"
                :placeholder="t('own.tip', { n: i + 1 })"
                autocomplete="off"
              />
            </li>
          </ol>

          <p class="text-xs text-slate-400">{{ t('own.saved') }} <template v-if="!isComplete(editing)">{{ t('own.incomplete') }}</template></p>
          <div class="flex flex-wrap justify-end gap-2">
            <button data-test="own-done" type="submit" class="btn btn-secondary">{{ t('own.done') }}</button>
            <button v-if="canUse" data-test="own-use-this" type="button" class="btn btn-primary" :disabled="!isComplete(editing)" @click="use(editing)">
              ✓ {{ t('own.use') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
