<template>
  <k-layout main="darker" :class="['page-market', modeClass]" menu="market">
    <template #left>
      <el-scrollbar>
        <market-filter v-model="words" :data="visibleData"></market-filter>
      </el-scrollbar>
    </template>

    <div v-if="marketLoading">
      <div class="el-loading-spinner">
        <svg class="circular" viewBox="25 25 50 50">
          <circle class="path" cx="50" cy="50" r="20" fill="none"></circle>
        </svg>
        <p class="el-loading-text">{{ t('marketPage.loading.title') }}</p>
        <p class="market-loading-detail">{{ t('marketPage.loading.registry', { value: loadingEndpoint }) }}</p>
      </div>
      <k-comment v-if="loadingSlow" type="warning" class="market-loading-warning">
        <p>{{ t('marketPage.loading.slow') }}</p>
        <p>
          {{ t('marketPage.loading.registry', { value: loadingEndpoint }) }}
          <template v-if="loadingTimeout"> · {{ t('marketPage.loading.timeoutLabel', { value: loadingTimeout }) }}</template>
          <template v-if="loadingAutoRoute"> · {{ t('marketPage.loading.autoRoute') }}</template>
        </p>
        <p style="margin-top: 0.5rem;">
          <el-button type="primary" size="small" @click="router.push('/settings/market')">{{ t('marketPage.loading.openMarketSettings') }}</el-button>
        </p>
      </k-comment>
    </div>

    <el-scrollbar ref="root" v-else-if="data.length">
      <div class="market-search-row">
        <market-search ref="searchBox" v-model="words"></market-search>
      </div>
      <market-list
        v-model="words"
        :data="visibleData"
        visibility-prepared
        :gravatar="marketGravatar"
        :debug="!!store.market.debug"
        @debug="updateClientDebug"
        @update:page="scrollToTop">
        <template #header="{ hasFilter, all, packages }">
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
        <template #action="data">
          <el-button
            solid
            :type="getType(data)"
            @click.stop.prevent="openPackage(data)">
            {{ getText(data) }}
          </el-button>
        </template>
      </market-list>
    </el-scrollbar>

    <k-comment v-else type="danger" class="market-error">
      <p>{{ t('marketPage.error.title') }}</p>
      <p>
        {{ t('marketPage.error.registry', { value: store.market?.registry || loadingEndpoint }) }}
        <template v-if="store.market?.error"> · {{ t('marketPage.error.reason', { value: store.market.error }) }}</template>
      </p>
      <ul>
        <li>{{ t('marketPage.error.networkHint') }}</li>
        <li>{{ t('marketPage.error.searchHint') }}</li>
      </ul>
      <p style="margin-top: 0.8rem;">
        <el-button type="primary" size="small" @click="router.push('/settings/market')">{{ t('marketPage.error.openRegistrySettings') }}</el-button>
      </p>
    </k-comment>
  </k-layout>
</template>

<script setup lang="ts">

import { global, router, store, useConfig } from '@koishijs/client'
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import type { SearchObject } from '@koishijs/registry'
import { active, activeBundle } from '../../lib/dialogs'
import { getFrontendMode } from '../../lib/market-config'
import { getMarketSilentFilters, getMarketSilentRules } from '../../lib/silent-rules'
import { getPendingOverrides } from '../../lib/data-store'
import { canInstallBundleSearchObject, getSilentFiltered, getVisible, kConfig, MarketFilter, MarketList, MarketSearch, parseSilentFilters } from '../../market'
import { getMarketSnapshotData, loadMarketSnapshot, marketSnapshot, marketSnapshotError, marketSnapshotLoading } from '../../market/state'
import { useMarketNextI18n } from '../../i18n'
import DebugPanel from './debug-panel.vue'
import { useRouteSync } from './use-route-sync'

function installed(data: SearchObject) {
  if (store.packages) {
    return !!store.packages[data.package.name]
  } else {
    return !!store.dependencies?.[data.package.name]
  }
}

const root = ref()
const searchBox = ref<{ focus?: () => void }>()
const config = useConfig()
const { t, locale } = useMarketNextI18n()
const frontendMode = computed(() => getFrontendMode(config.value))
const marketGravatar = computed(() => config.value.market?.gravatar || store.market?.gravatar)
const silentFilters = computed(() => {
  const rules = getMarketSilentRules(config.value)
  if (rules.length) return rules
  return parseSilentFilters(getMarketSilentFilters(config.value))
})
const modeClass = computed(() => `market-mode-${frontendMode.value}`)

provide(kConfig, {
  installed: global.static ? undefined : installed,
})

const words = ref<string[]>([''])

const data = computed(() => Object.values(getMarketSnapshotData()))

const silentData = computed(() => getSilentFiltered(data.value, silentFilters.value, {
  installed: global.static ? undefined : installed,
}))

const visibilityMode = computed(() => {
  return `${words.value.includes('show:hidden') ? 1 : 0}:${words.value.includes('show:deprecated') ? 1 : 0}`
})

const visibleData = computed(() => {
  const [hidden, deprecated] = visibilityMode.value.split(':')
  const visibilityWords = [
    hidden === '1' ? 'show:hidden' : '',
    deprecated === '1' ? 'show:deprecated' : '',
  ].filter(Boolean)
  return getVisible(silentData.value, visibilityWords)
})

const clientDebug = ref<{
  timings?: Record<string, number>
  total?: number
  matched?: number
  visible?: number
  rendered?: number
}>({})

const marketLoading = computed(() => {
  if (data.value.length) return false
  if (marketSnapshotError.value) return false
  if (marketSnapshotLoading.value) return true
  const state = marketSnapshot.value ?? store.market
  if (!state || state.loading) return true
  const hasResolvedSnapshot = !!marketSnapshot.value || !!store.market?.data
  return !hasResolvedSnapshot && (state.total ?? 0) > 0
})
const loadingSlow = ref(false)
let loadingTimer: ReturnType<typeof setTimeout>

const loadingEndpoint = computed(() => {
  return store.market?.registry || config.value.market?.search?.endpoint || 'https://registry.koishi.t4wefan.pub/index.json'
})

const loadingTimeout = computed(() => {
  const timeout = config.value.market?.search?.timeout
  if (!timeout) return ''
  if (typeof timeout === 'number') return timeout >= 1000 ? `${Math.round(timeout / 1000)}s` : `${timeout}ms`
  return String(timeout)
})

const loadingAutoRoute = computed(() => config.value.market?.search?.autoRoute !== false)

const showMarketCacheHint = computed(() => config.value.market?.search?.logLevel !== 'silent')

useRouteSync(words)

watch(marketLoading, (loading) => {
  loadingSlow.value = false
  clearTimeout(loadingTimer)
  if (loading) scheduleLoadingWarning()
}, { immediate: true })

watch(() => store.market?.dataVersion, (version, previous) => {
  if (version == null || version === previous) return
  void loadMarketSnapshot().catch(error => console.error('[market-next] failed to refresh market index', error))
})

onMounted(() => {
  scheduleLoadingWarning()
  window.addEventListener('keydown', onSearchShortcut)
  void loadMarketSnapshot().catch(error => console.error('[market-next] failed to load market index', error))
})

onUnmounted(() => {
  clearTimeout(loadingTimer)
  window.removeEventListener('keydown', onSearchShortcut)
})

function onSearchShortcut(event: KeyboardEvent) {
  if (router.currentRoute.value?.path !== '/market') return
  if (event.key.toLowerCase() !== 'k') return
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  searchBox.value?.focus?.()
}

function scheduleLoadingWarning() {
  clearTimeout(loadingTimer)
  if (!marketLoading.value) return
  loadingTimer = setTimeout(() => {
    if (marketLoading.value) loadingSlow.value = true
  }, 8000)
}

function getType(data: SearchObject) {
  if (global.static) return 'primary'
  const version = getPendingOverrides()[data.package.name]
  if (installed(data)) {
    if (version === '') return 'danger'
    if (version) return 'warning'
    return 'success'
  }
  if (version) return 'warning'
  return 'primary'
}

function getText(data: SearchObject) {
  if (global.static) return t('marketPage.actions.config')
  const version = getPendingOverrides()[data.package.name]
  if (installed(data)) {
    if (version === '') return t('marketPage.actions.waitingRemove')
    if (version) return t('marketPage.actions.waitingUpdate')
    return t('marketPage.actions.edit')
  }
  if (version) return t('marketPage.actions.waitingInstall')
  return t('marketPage.actions.addPlugin')
}

function openPackage(data: SearchObject) {
  if (!global.static && canInstallBundleSearchObject(data)) {
    activeBundle.value = data
    return
  }
  active.value = data.package.name
}

function scrollToTop() {
  root.value?.scrollTo(0, 0)
}

function formatTime(value: number) {
  return new Date(value).toLocaleString(locale.value)
}

function updateClientDebug(value: typeof clientDebug.value) {
  clientDebug.value = value
}

</script>

<style scoped src="./index.scss" lang="scss"></style>
