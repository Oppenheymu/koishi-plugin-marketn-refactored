<template>
  <div class="market-hint text-center">
    {{ hasFilter ? t('marketPage.results.filtered', { filtered: packages.length, total: all.length }) : t('marketPage.results.all', { total: all.length }) }}
  </div>
  <k-comment v-if="showMarketCacheHint && store.market.stale" type="warning" class="market-stale">
    <p>{{ t('marketPage.cache.stale') }}</p>
    <p>
      {{ t('marketPage.registry.label', { value: store.market.registry || t('marketPage.registry.unknown') }) }}
      <template v-if="store.market.error"> · {{ t('marketPage.registry.reason', { value: store.market.error }) }}</template>
    </p>
  </k-comment>
  <k-comment v-else-if="showMarketCacheHint && store.market.cached" type="warning" class="market-stale">
    <p>
      {{ t('marketPage.cache.cached') }}
      <template v-if="store.market.refreshing">{{ t('marketPage.cache.refreshing') }}</template>
    </p>
    <p>
      {{ t('marketPage.registry.label', { value: store.market.registry || t('marketPage.registry.unknown') }) }}
      <template v-if="store.market.cachedAt"> · {{ t('marketPage.cache.cachedAt', { value: formatTime(store.market.cachedAt) }) }}</template>
      <template v-if="store.market.validatedAt"> · {{ t('marketPage.cache.validatedAt', { value: formatTime(store.market.validatedAt) }) }}</template>
    </p>
  </k-comment>
  <debug-panel :client-debug="clientDebug"></debug-panel>
</template>

<script setup lang="ts">
import { store } from '@koishijs/client'
import { inject } from 'vue'
import type { SearchObject } from '@koishijs/registry'
import { useMarketNextI18n } from '../../../i18n'
import { marketPageContextKey } from '../composables/use-market-page'
import DebugPanel from './debug-panel/index.vue'

defineProps<{
  hasFilter: boolean
  all: SearchObject[]
  packages: SearchObject[]
}>()

const { t } = useMarketNextI18n()
const page = inject(marketPageContextKey)!
const { showMarketCacheHint, clientDebug, formatTime } = page
</script>
