<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { SUPPORTED } from '../i18n';

const { t, locale } = useI18n();
</script>

<template>
  <label class="flex items-center gap-2 text-sm text-slate-300">
    <span class="sr-only sm:not-sr-only">{{ t('language.label') }}</span>
    <select v-model="locale" data-test="language" class="field w-auto py-1">
      <option v-for="code in SUPPORTED" :key="code" :value="code">{{ t(`language.${code}`) }}</option>
    </select>
  </label>
</template>
