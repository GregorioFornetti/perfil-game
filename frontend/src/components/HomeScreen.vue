<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NAME_KEY, type GameStore } from '../store';
import { MAX_NAME_LENGTH } from '../types';

const props = defineProps<{ store: GameStore }>();
const { t, tm, rt } = useI18n();

function saved(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

const name = ref(saved(NAME_KEY));
// An invite link looks like http://host/#ABCD
const codeInLink = () => window.location.hash.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase();
const code = ref(codeInLink());
// Opened from an invite link: joining that room is what the visitor wants, so it comes first.
const invited = ref(code.value.length === 4);
const nameInput = ref<HTMLInputElement | null>(null);

// An invite link opened in a tab already showing the game changes only the part after "#",
// which does not reload the page: pick the code up anyway.
async function onLinkChange() {
  const fromLink = codeInLink();
  if (fromLink.length !== 4) return;
  code.value = fromLink;
  invited.value = true;
  await nextTick();
  nameInput.value?.focus();
}
onMounted(() => {
  if (invited.value) nameInput.value?.focus();
  window.addEventListener('hashchange', onLinkChange);
});
onBeforeUnmount(() => window.removeEventListener('hashchange', onLinkChange));
function leaveInvite() {
  invited.value = false;
  code.value = '';
  history.replaceState(null, '', window.location.pathname);
}
const busy = ref(false);
const hasName = computed(() => name.value.trim().length > 0);
const steps = computed(() => (tm('home.how') as unknown[]).map((s) => rt(s as string)));

async function run(action: () => Promise<boolean>) {
  if (busy.value) return;
  busy.value = true;
  await action();
  busy.value = false;
}
const create = () => run(() => props.store.createRoom(name.value.trim()));
const join = () => run(() => props.store.joinRoom(code.value.trim(), name.value.trim()));
</script>

<template>
  <div class="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
    <section class="panel flex flex-col gap-4">
      <!-- Opened from an invite link: one clear action, join that room -->
      <template v-if="invited">
        <div data-test="invite" class="rounded-xl border border-amber-400/60 bg-amber-400/10 p-4 text-center">
          <p class="text-sm text-amber-200">{{ t('home.invited') }}</p>
          <p class="font-mono text-4xl font-black tracking-[0.2em] text-amber-300">{{ code }}</p>
        </div>

        <form class="flex flex-col gap-4" @submit.prevent="join">
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium text-slate-300">{{ t('home.name') }}</span>
            <input ref="nameInput" v-model="name" data-test="name" class="field" :maxlength="MAX_NAME_LENGTH" :placeholder="t('home.namePlaceholder')" autocomplete="nickname" />
          </label>
          <button data-test="join" type="submit" class="btn btn-primary py-3 text-lg" :disabled="!hasName || busy || !store.state.connected">
            {{ t('home.joinRoom', { code }) }}
          </button>
        </form>

        <button data-test="not-invited" type="button" class="btn btn-ghost self-center text-sm" @click="leaveInvite">{{ t('home.notInvited') }}</button>
      </template>

      <template v-else>
      <p class="text-slate-300">{{ t('app.tagline') }}</p>

      <label class="flex flex-col gap-1">
        <span class="text-sm font-medium text-slate-300">{{ t('home.name') }}</span>
        <input v-model="name" data-test="name" class="field" :maxlength="MAX_NAME_LENGTH" :placeholder="t('home.namePlaceholder')" autocomplete="nickname" />
      </label>

      <button data-test="create" class="btn btn-primary" :disabled="!hasName || busy || !store.state.connected" @click="create">
        {{ t('home.create') }}
      </button>

      <div class="flex items-center gap-3 text-sm text-slate-400">
        <span class="h-px flex-1 bg-slate-600"></span>{{ t('home.or') }}<span class="h-px flex-1 bg-slate-600"></span>
      </div>

      <form class="flex items-end gap-2" @submit.prevent="join">
        <label class="flex flex-1 flex-col gap-1">
          <span class="text-sm font-medium text-slate-300">{{ t('home.code') }}</span>
          <input
            v-model="code"
            data-test="code"
            class="field font-mono text-lg uppercase tracking-[0.3em]"
            maxlength="4"
            :placeholder="t('home.codePlaceholder')"
            autocomplete="off"
          />
        </label>
        <button data-test="join" type="submit" class="btn btn-secondary" :disabled="!hasName || code.trim().length < 4 || busy || !store.state.connected">
          {{ t('home.join') }}
        </button>
      </form>
      </template>
    </section>

    <section class="panel">
      <h2 class="mb-3 text-lg font-bold text-amber-300">{{ t('home.howTitle') }}</h2>
      <ol class="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
        <li v-for="(step, i) in steps" :key="i">{{ step }}</li>
      </ol>
    </section>
  </div>
</template>
