<template>
  <k-layout main="page-deps" :class="[modeClass, layoutClass]" menu="dependencies">
    <div class="deps-toolbar">
      <div class="deps-toolbar-row">
        <el-select v-model="filter" size="small" class="deps-filter-select">
          <el-option
            v-for="option in filterOptions"
            :key="option.value"
            :value="option.value"
            :label="option.label + (option.count ? ' (' + option.count + ')' : '')"
          >
            <span class="deps-filter-option">
              <market-icon :name="option.icon"></market-icon>
              <span>{{ option.label }}</span>
              <span v-if="option.count" class="deps-filter-count">({{ option.count }})</span>
            </span>
          </el-option>
        </el-select>
        <button
          :class="['deps-filter', 'deps-prerelease-toggle', { active: prereleaseBlocked }]"
          @click="togglePrereleaseFilter"
        >
          <market-icon name="tag"></market-icon>
          <span>{{ t('dependencies.toolbar.blockPreview') }}</span>
        </button>
        <button
          class="deps-filter deps-layout-toggle"
          @click="toggleLayout"
          :title="depsLayout === 'grid' ? t('dependencies.toolbar.listView') : t('dependencies.toolbar.gridView')"
        >
          <svg v-if="depsLayout === 'grid'" viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="currentColor">
            <path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="currentColor">
            <path d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z"/>
          </svg>
          <span>{{ depsLayout === 'grid' ? t('dependencies.toolbar.listView') : t('dependencies.toolbar.gridView') }}</span>
        </button>
        <div class="deps-search">
          <el-input ref="searchInput" v-model="keyword" clearable :placeholder="t('dependencies.toolbar.searchPlaceholder')"></el-input>
        </div>
        <div class="deps-summary">
          <span v-if="summary.pending" class="primary">{{ t('dependencies.filters.pending') }} {{ summary.pending }}</span>
          <span v-if="summary.updatable" class="success">{{ t('dependencies.filters.updatable') }} {{ summary.updatable }}</span>
          <span v-if="summary.unconfigured" class="warning">{{ t('dependencies.filters.unconfigured') }} {{ summary.unconfigured }}</span>
          <span v-if="summary.errors" class="danger">{{ t('dependencies.filters.error') }} {{ summary.errors }}</span>
          <span v-if="summary.invalid" class="warning">{{ t('dependencies.filters.invalid') }} {{ summary.invalid }}</span>
          <span v-if="refreshing" class="loading">{{ t('dependencies.toolbar.loading') }}</span>
        </div>
      </div>
    </div>

    <el-scrollbar class="body-container">
      <div class="deps-content" :class="{ pending: summary.pending }">
        <template v-if="visibleGroups.length">
          <section v-for="group in visibleGroups" :key="group.key" :class="['deps-group', group.key, { collapsed: group.collapsed }]">
            <header
              :class="['deps-group-header', { collapsible: group.collapsible }]"
              :role="group.collapsible ? 'button' : undefined"
              :tabindex="group.collapsible ? 0 : undefined"
              :aria-expanded="group.collapsible ? String(!group.collapsed) : undefined"
              @click="group.collapsible && toggleGroup(group.key)"
              @keydown.enter.prevent="group.collapsible && toggleGroup(group.key)"
              @keydown.space.prevent="group.collapsible && toggleGroup(group.key)"
            >
              <div>
                <h2>
                  <market-icon :name="group.icon"></market-icon>
                  <span>{{ group.label }}</span>
                </h2>
                <p>{{ group.description }}</p>
              </div>
              <div class="deps-group-side">
                <span class="deps-group-count">{{ group.items.length }}</span>
                <market-icon
                  v-if="group.collapsible"
                  :class="['deps-group-chevron', { collapsed: group.collapsed }]"
                  name="asc"
                ></market-icon>
              </div>
            </header>
            <div v-if="!group.collapsed" class="deps-grid">
              <template v-if="depsLayout === 'list'">
                <div class="deps-list-header">
                  <span class="col-icon"></span>
                  <span class="col-name">{{ t('common.labels.name') }}</span>
                  <span class="col-version">{{ t('common.labels.installed') }}</span>
                  <span class="col-latest">{{ t('common.labels.latest') }}</span>
                  <span class="col-actions">{{ t('common.labels.operation') }}</span>
                </div>
              </template>
              <package-view
                v-for="item in group.items"
                :key="item.name"
                :name="item.name"
                :kind="item.kind"
                :list-mode="depsLayout === 'list'"
              ></package-view>
            </div>
          </section>
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

<script lang="ts" setup>

import { computed, onBeforeUnmount, onMounted, ref, watch, WatchStopHandle } from 'vue'
import { message, router, store, useConfig, useContext } from '@koishijs/client'
import { useMarketNextI18n } from '../i18n'
import { getBundleRecords, getCollapsedGroups, getFrontendMode, getDepsLayout, getLatestVersion, getMarketNextConfig, getMarketNextPolicy, getPendingOverrides, getWritableMarketNextPolicy, hasUpdate, isUpdateCheckDisabled, isUpdateIgnored, patchMarketNextConfig, patchMarketNextData } from '../utils'
import { addManual, createLocalBundleRecord, getConfigWriter, getRegistryStatus, showConfirm, showEnvironmentVersions, type ClientConfigWriter } from './utils'
import ManualInstall from './manual.vue'
import PackageView from './package.vue'
import MarketIcon from '../market/icons'
import { isBundlePackageName } from '../../src/shared/bundle'
import { shouldIncludeDiscoveredLocalPlugin } from '../../src/shared/dependency-source'
import { loadMarketObjects } from '../market/state'

type FilterKey = 'all' | 'pending' | 'bundle' | 'unconfigured' | 'updatable' | 'ignored' | 'check-disabled' | 'invalid' | 'error' | 'local' | 'manual'
type ItemKind = 'pending' | 'bundle' | 'unconfigured' | 'updatable' | 'ignored' | 'check-disabled' | 'invalid' | 'error' | 'local' | 'manual' | 'installed'

interface DependencyItem {
  name: string
  kind: ItemKind
  pending: boolean
  manual: boolean
}

interface DependencyGroup {
  key: ItemKind
  label: string
  description: string
  icon: string
  items: DependencyItem[]
  collapsed: boolean
  collapsible: boolean
}

const config = useConfig()
const ctx = useContext()
const { t } = useMarketNextI18n()
const keyword = ref('')
const filter = ref<FilterKey>('all')
const searchInput = ref<{ focus?: () => void }>()
const frontendMode = computed(() => getFrontendMode(config.value))
const depsLayout = computed(() => getDepsLayout(config.value))
const modeClass = computed(() => `market-mode-${frontendMode.value}`)
const layoutClass = computed(() => `deps-layout-${depsLayout.value}`)

function getOverride() {
  return getPendingOverrides()
}

function getUpdatePolicy() {
  return getMarketNextPolicy(config.value)
}

function isManageableBundle(name: string) {
  return !!(getBundleRecords(config.value)[name] || createLocalBundleRecord(name))
}

const names = computed(() => {
  const configWriter = getConfigWriter(ctx)
  const explicit: Record<string, unknown> = {
    ...(store.dependencies ?? {}),
    ...getOverride(),
  }
  for (const name of Object.keys(store.packages ?? {})) {
    const pkg = store.packages?.[name]
    if (isUnconfigured(name, configWriter)
      || isManageableBundle(name)
      || isPluginPackage(name) && shouldIncludeDiscoveredLocalPlugin({
        declared: !!store.dependencies?.[name],
        configured: !!configWriter?.get(name)?.length,
        running: !!pkg?.runtime?.id,
        workspace: !!pkg?.workspace,
      })) {
      explicit[name] = true
    }
  }
  return Object
    .keys(explicit)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
})

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
  searchInput.value?.focus?.()
}

function classify(name: string, configWriter?: ClientConfigWriter): ItemKind {
  const dep = store.dependencies?.[name]
  const override = getOverride()
  const pending = Object.prototype.hasOwnProperty.call(override, name)
  if (pending) return 'pending'
  if (!dep) return store.packages?.[name] ? 'local' : 'manual'
  if (dep.local || dep.workspace) return 'local'
  if (dep.invalid) return 'invalid'
  if (isManageableBundle(name)) return 'bundle'
  if (isUnconfigured(name, configWriter)) return 'unconfigured'
  const status = getRegistryStatus(name)
  if (status?.error) return 'error'
  if (isUpdateCheckDisabled(name, getUpdatePolicy())) return 'check-disabled'
  if (isUpdateIgnored(name, getUpdatePolicy())) return 'ignored'
  if (hasUpdate(name, getUpdatePolicy())) return 'updatable'
  return 'installed'
}

function isPluginPackage(name: string) {
  return /^@koishijs\/plugin-[0-9a-z-]+$/.test(name) || /(^|\/)koishi-plugin-[0-9a-z-]+$/.test(name)
}

function isUnconfigured(name: string, configWriter = getConfigWriter(ctx)) {
  if (isManageableBundle(name)) return false
  return !!configWriter && !!store.packages?.[name] && isPluginPackage(name) && !configWriter.get(name)?.length
}

const items = computed<DependencyItem[]>(() => {
  const configWriter = getConfigWriter(ctx)
  return names.value.map(name => ({
    name,
    kind: classify(name, configWriter),
    pending: Object.prototype.hasOwnProperty.call(getOverride(), name),
    manual: !store.dependencies?.[name] && !store.packages?.[name],
  }))
})

const updates = computed(() => items.value.filter(item => item.kind === 'updatable').map(item => item.name))

const prereleaseBlocked = computed(() => !!getUpdatePolicy().updateIgnorePrerelease)

const summary = computed(() => {
  return {
    total: items.value.length,
    updatable: items.value.filter(item => item.kind === 'updatable').length,
    bundle: items.value.filter(item => item.kind === 'bundle').length,
    pending: Object.keys(getOverride()).length,
    unconfigured: items.value.filter(item => item.kind === 'unconfigured').length,
    ignored: items.value.filter(item => item.kind === 'ignored').length,
    checkDisabled: items.value.filter(item => item.kind === 'check-disabled').length,
    invalid: items.value.filter(item => item.kind === 'invalid').length,
    errors: items.value.filter(item => item.kind === 'error').length,
    local: items.value.filter(item => item.kind === 'local').length,
    manual: items.value.filter(item => item.manual).length,
  }
})

const refreshing = computed(() => {
  return Object.values((store as typeof store & { registryStatus?: Record<string, { loading?: boolean }> }).registryStatus ?? {})
    .some(status => status.loading)
})

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

const groupMeta = computed<Record<ItemKind, Omit<DependencyGroup, 'items' | 'collapsed' | 'collapsible'>>>(() => ({
  pending: { key: 'pending', label: t('dependencies.groups.pending.label'), icon: 'tag', description: t('dependencies.groups.pending.description') },
  bundle: { key: 'bundle', label: t('dependencies.groups.bundle.label'), icon: 'file-archive', description: t('dependencies.groups.bundle.description') },
  updatable: { key: 'updatable', label: t('dependencies.groups.updatable.label'), icon: 'asc', description: t('dependencies.groups.updatable.description') },
  ignored: { key: 'ignored', label: t('dependencies.groups.ignored.label'), icon: 'installed', description: t('dependencies.groups.ignored.description') },
  'check-disabled': { key: 'check-disabled', label: t('dependencies.groups.checkDisabled.label'), icon: 'installed', description: t('dependencies.groups.checkDisabled.description') },
  unconfigured: { key: 'unconfigured', label: t('dependencies.groups.unconfigured.label'), icon: 'preview', description: t('dependencies.groups.unconfigured.description') },
  invalid: { key: 'invalid', label: t('dependencies.groups.invalid.label'), icon: 'insecure', description: t('dependencies.groups.invalid.description') },
  error: { key: 'error', label: t('dependencies.groups.error.label'), icon: 'insecure', description: t('dependencies.groups.error.description') },
  local: { key: 'local', label: t('dependencies.groups.local.label'), icon: 'file-archive', description: t('dependencies.groups.local.description') },
  manual: { key: 'manual', label: t('dependencies.groups.manual.label'), icon: 'search', description: t('dependencies.groups.manual.description') },
  installed: { key: 'installed', label: t('dependencies.groups.installed.label'), icon: 'installed', description: t('dependencies.groups.installed.description') },
}))

const groupOrder: ItemKind[] = ['pending', 'bundle', 'unconfigured', 'updatable', 'ignored', 'check-disabled', 'invalid', 'error', 'local', 'manual', 'installed']

const collapseEnabled = computed(() => filter.value === 'all' && !keyword.value.trim())

function getDefaultCollapsed(key: ItemKind) {
  return key === 'unconfigured' || key === 'ignored'
}

function isGroupCollapsed(key: ItemKind) {
  if (!collapseEnabled.value) return false
  return getCollapsedGroups()[key] ?? getDefaultCollapsed(key)
}

function toggleGroup(key: ItemKind) {
  const groups = {
    ...getCollapsedGroups(),
    [key]: !isGroupCollapsed(key),
  }
  void patchMarketNextData({ collapsedGroups: groups })
}

function toggleLayout() {
  if (!config.value.market) config.value.market = {}
  const next = depsLayout.value === 'grid' ? 'list' : 'grid'
  config.value.market.depsLayout = next
  const pluginConfig = getMarketNextConfig()
  if (pluginConfig) pluginConfig.depsLayout = next
  patchMarketNextConfig({ depsLayout: next })
}

const visibleGroups = computed<DependencyGroup[]>(() => {
  const word = keyword.value.trim().toLowerCase()
  const buckets = Object.fromEntries(groupOrder.map(key => [key, [] as DependencyItem[]])) as Record<ItemKind, DependencyItem[]>
  for (const item of items.value) {
    if (filter.value === 'pending' && !item.pending) continue
    if (!item.pending) {
      if (filter.value === 'manual' && !item.manual) continue
      if (!['all', 'pending', 'manual'].includes(filter.value) && item.kind !== filter.value) continue
    }
    if (word && !item.name.toLowerCase().includes(word)) continue
    buckets[item.kind].push(item)
  }
  return groupOrder
    .map(key => ({
       ...groupMeta.value[key],
      items: buckets[key],
      collapsed: isGroupCollapsed(key),
      collapsible: collapseEnabled.value,
    }))
    .filter(group => group.items.length)
})

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

<style lang="scss" src="./dependencies.scss"></style>
