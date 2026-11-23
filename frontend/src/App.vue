<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import GameScreen from './components/GameScreen.vue';
import HomeScreen from './components/HomeScreen.vue';
import LanguageSwitcher from './components/LanguageSwitcher.vue';
import LobbyScreen from './components/LobbyScreen.vue';
import { LOCALE_KEY } from './i18n';
import type { GameStore } from './store';

const props = defineProps<{ store: GameStore }>();
const { t, locale } = useI18n();

const state = props.store.state;
const view = computed(() => state.view);
const errorText = computed(() => (state.error ? (state.error.text ?? t(state.error.key ?? 'connection.noReply')) : ''));

watch(
  locale,
  (value) => {
    document.documentElement.lang = value;
    document.title = t('app.title');
    try {
      localStorage.setItem(LOCALE_KEY, value);
    } catch {
      /* private browsing: the choice just is not remembered */
    }
    // the server sends the cards in the player's language
    if (state.connected) void props.store.setLocale(value);
  },
  { immediate: true },
);

let errorTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => state.error,
  (error) => {
    clearTimeout(errorTimer);
    if (error) errorTimer = setTimeout(() => props.store.clearError(), 6000);
  },
);
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-10">
    <header class="flex items-center justify-between gap-4 py-4">
      <h1 class="font-display text-2xl font-extrabold tracking-tight text-amber-300">🃏 {{ t('app.title') }}</h1>
      <LanguageSwitcher />
    </header>

    <p v-if="!state.connected" data-test="offline" class="mb-4 rounded-lg bg-slate-700/80 px-4 py-2 text-sm text-slate-200">
      {{ t('connection.offline') }}
    </p>

    <main class="flex-1">
      <HomeScreen v-if="!view" :store="store" />
      <LobbyScreen v-else-if="view.phase === 'lobby'" :store="store" :view="view" />
      <GameScreen v-else :store="store" :view="view" />
    </main>

    <div
      v-if="errorText"
      data-test="error"
      role="alert"
      class="fixed inset-x-0 bottom-4 z-50 mx-auto w-fit max-w-[90vw] cursor-pointer rounded-lg bg-rose-600 px-4 py-3 font-medium text-white shadow-2xl"
      @click="store.clearError()"
    >
      {{ errorText }}
    </div>
  </div>
</template>
