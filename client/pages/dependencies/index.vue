<template>
  <k-layout main="page-deps" :class="[modeClass, layoutClass]" menu="dependencies">
    <toolbar
      ref="toolbarRef"
      v-model:filter="filter"
      v-model:keyword="keyword"
      :filter-options="filterOptions"
      :prerelease-blocked="prereleaseBlocked"
      :deps-layout="depsLayout"
      :summary="summary"
      :refreshing="refreshing"
      @toggle-prerelease="togglePrereleaseFilter"
      @toggle-layout="toggleLayout"
    ></toolbar>

    <el-scrollbar class="body-container">
      <div class="deps-content" :class="{ pending: summary.pending }">
        <template v-if="visibleGroups.length">
          <group-section
            v-for="group in visibleGroups"
            :key="group.key"
            :group="group"
            :deps-layout="depsLayout"
            :toggle-group="toggleGroup"
          ></group-section>
        </template>
        <k-empty v-else>{{ t('dependencies.empty') }}</k-empty>
      </div>
    </el-scrollbar>
  </k-layout>

  <div v-if="summary.pending" :class="['deps-apply-bar', modeClass]">
    <div>
      <strong>{{ t('dependencies.apply.count', { count: summary.pending }) }}</strong>
      <span>{{ t('dependencies.apply.description') }}</span>
    </div>
    <div class="deps-apply-actions">
      <el-button @click="clearChanges">{{ t('dependencies.apply.discard') }}</el-button>
      <el-button type="primary" @click="showConfirm = true">{{ t('dependencies.apply.apply') }}</el-button>
    </div>
  </div>

  <manual-install/>
</template>

<script setup lang="ts">

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { WatchStopHandle } from 'vue'
import { message, router, store, useConfig, useContext } from '@koishijs/client'
import { useMarketNextI18n } from '../../i18n'
import { getDepsLayout, getFrontendMode, getMarketNextConfig, getWritableMarketNextPolicy, patchMarketNextConfig } from '../../lib/market-config'
import { getPendingOverrides, patchMarketNextData } from '../../lib/data-store'
import { getLatestVersion } from '../../lib/update-policy'
import { showConfirm } from '../../lib/dialogs'
import { addManual } from '../../lib/analyze-versions'
import { loadMarketObjects } from '../../market/state'
import ManualInstall from '../../dialogs/manual.vue'
import Toolbar from './toolbar.vue'
import GroupSection from './group-section.vue'
import { useClassify } from './useClassify'
import type { FilterKey } from './useClassify'
import { useGroups } from './use-groups'

const config = useConfig()
const ctx = useContext()
const { t } = useMarketNextI18n()
const keyword = ref('')
const filter = ref<FilterKey>('all')
const toolbarRef = ref<{ focus?: () => void }>()
const frontendMode = computed(() => getFrontendMode(config.value))
const depsLayout = computed(() => getDepsLayout(config.value))
const modeClass = computed(() => `market-mode-${frontendMode.value}`)
const layoutClass = computed(() => `deps-layout-${depsLayout.value}`)

const { getUpdatePolicy, names, items, updates, prereleaseBlocked, summary, refreshing } = useClassify()

watch(names, (value) => {
  void loadMarketObjects(value).catch(error => {
    console.error('[market-next] failed to load dependency market metadata', error)
  })
}, { immediate: true })

let dispose: WatchStopHandle
watch(() => store.market?.registry, (registry) => {
  dispose?.()
  if (!registry) return
  dispose = watch(() => getPendingOverrides(), (object) => {
    if (!object) return
    Object.keys(object).forEach(async (name) => {
      if (store.dependencies?.[name]) return
      addManual(name)
    })
  }, { immediate: true, deep: true })
}, { immediate: true })

onMounted(() => {
  window.addEventListener('keydown', onSearchShortcut)
})

onBeforeUnmount(() => {
  dispose?.()
  window.removeEventListener('keydown', onSearchShortcut)
})

function onSearchShortcut(event: KeyboardEvent) {
  if (router.currentRoute.value?.path !== '/dependencies') return
  if (event.key.toLowerCase() !== 'k') return
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  toolbarRef.value?.focus?.()
}

const filterOptions = computed(() => [
  { value: 'all' as const, label: t('dependencies.filters.all'), icon: 'solid:all', count: summary.value.total },
  { value: 'pending' as const, label: t('dependencies.filters.pending'), icon: 'tag', count: summary.value.pending },
  { value: 'bundle' as const, label: t('dependencies.filters.bundle'), icon: 'file-archive', count: summary.value.bundle },
  { value: 'unconfigured' as const, label: t('dependencies.filters.unconfigured'), icon: 'preview', count: summary.value.unconfigured },
  { value: 'updatable' as const, label: t('dependencies.filters.updatable'), icon: 'asc', count: summary.value.updatable },
  { value: 'ignored' as const, label: t('dependencies.filters.ignored'), icon: 'installed', count: summary.value.ignored },
  { value: 'check-disabled' as const, label: t('dependencies.filters.checkDisabled'), icon: 'installed', count: summary.value.checkDisabled },
  { value: 'invalid' as const, label: t('dependencies.filters.invalid'), icon: 'insecure', count: summary.value.invalid },
  { value: 'error' as const, label: t('dependencies.filters.error'), icon: 'insecure', count: summary.value.errors },
  { value: 'local' as const, label: t('dependencies.filters.local'), icon: 'file-archive', count: summary.value.local },
  { value: 'manual' as const, label: t('dependencies.filters.manual'), icon: 'search', count: summary.value.manual },
])

const { visibleGroups, toggleGroup } = useGroups(items, keyword, filter)

function toggleLayout() {
  if (!config.value.market) config.value.market = {}
  const next = depsLayout.value === 'grid' ? 'list' : 'grid'
  config.value.market.depsLayout = next
  const pluginConfig = getMarketNextConfig()
  if (pluginConfig) pluginConfig.depsLayout = next
  patchMarketNextConfig({ depsLayout: next })
}

function clearChanges() {
  const override = getPendingOverrides()
  for (const key of Object.keys(override)) delete override[key]
  void patchMarketNextData({ override: { ...override } })
}

async function togglePrereleaseFilter() {
  const policy = getWritableMarketNextPolicy(config.value)
  const previous = !!policy.updateIgnorePrerelease
  policy.updateIgnorePrerelease = !previous
  const saved = await patchMarketNextConfig({ updateIgnorePrerelease: policy.updateIgnorePrerelease })
  if (!saved) {
    policy.updateIgnorePrerelease = previous
    message.error(t('common.messages.saveFailed'))
  }
}

ctx.action('dependencies.upgrade', {
  disabled: () => !updates.value.length,
  async action() {
    for (const name of updates.value) {
      const version = getLatestVersion(name, getUpdatePolicy())
      if (!version) continue
      getPendingOverrides()[name] = version
    }
    void patchMarketNextData({ override: { ...getPendingOverrides() } })
  },
})

</script>

<style scoped src="./index.scss" lang="scss"></style>
