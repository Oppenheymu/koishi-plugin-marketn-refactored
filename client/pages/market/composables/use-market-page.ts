import { global, store, useConfig } from '@koishijs/client'
import { computed, onMounted, onUnmounted, provide, ref, watch, type ComputedRef, type InjectionKey, type Ref } from 'vue'
import type { SearchObject } from '@koishijs/registry'
import { active, activeBundle } from '../../../shared/ui/dialogs'
import { getFrontendMode, type FrontendMode } from '../../../shared/config/market-config'
import { getMarketSilentFilters, getMarketSilentRules } from '../../../shared/config/silent-rules'
import { getPendingOverrides } from '../../../shared/config/data-store'
import { canInstallBundleSearchObject, getSilentFiltered, getVisible, kConfig, parseSilentFilters } from '../../../market'
import { getMarketSnapshotData, loadMarketSnapshot, marketSnapshot, marketSnapshotError, marketSnapshotLoading } from '../../../market/state'
import { useMarketNextI18n } from '../../../i18n'
import { useRouteSync } from './use-route-sync'

export interface MarketDebug {
  timings?: Record<string, number>
  total?: number
  matched?: number
  visible?: number
  rendered?: number
}

export interface MarketPageState {
  words: Ref<string[]>
  visibleData: ComputedRef<SearchObject[]>
  marketGravatar: ComputedRef<string | undefined>
  clientDebug: Ref<MarketDebug>
  showMarketCacheHint: ComputedRef<boolean>
  formatTime: (value: number) => string
  getType: (data: SearchObject) => string
  getText: (data: SearchObject) => string
  openPackage: (data: SearchObject) => void
  updateClientDebug: (value: MarketDebug) => void
}

export const marketPageContextKey: InjectionKey<MarketPageState> = Symbol('market-page')

type PageConfigSource = {
  market?: {
    frontendMode?: FrontendMode
    gravatar?: string
    search?: { endpoint?: string; timeout?: number; autoRoute?: boolean; logLevel?: string }
  }
}

function installed(data: SearchObject) {
  if (store.packages) return !!store.packages[data.package.name]
  return !!store.dependencies?.[data.package.name]
}

/** 数据源 + 静默筛选 + 可见性模式（市场列表数据面）。 */
function useMarketDataState() {
  const config = useConfig() as Ref<PageConfigSource>
  const frontendMode = computed(() => getFrontendMode(config.value))
  const marketGravatar = computed(() => config.value.market?.gravatar || marketSnapshot.value?.gravatar)
  const silentConfig = config.value as Parameters<typeof getMarketSilentRules>[0]
  const silentFilters = computed(() => {
    const rules = getMarketSilentRules(silentConfig)
    if (rules.length) return rules
    return parseSilentFilters(getMarketSilentFilters(silentConfig))
  })
  const modeClass = computed(() => `market-mode-${frontendMode.value}`)
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
  useRouteSync(words)
  return { words, visibleData, marketGravatar, modeClass }
}

/** 加载状态面：市场数据加载中/慢/超时与缓存提示。 */
function useMarketLoadingState() {
  const data = computed(() => Object.values(getMarketSnapshotData()))
  const marketLoading = computed(() => {
    if (data.value.length) return false
    if (marketSnapshotError.value) return false
    if (marketSnapshotLoading.value) return true
    const state = marketSnapshot.value
    if (!state || state.loading) return true
    const hasResolvedSnapshot = !!marketSnapshot.value
    return !hasResolvedSnapshot && (state.total ?? 0) > 0
  })
  const loadingSlow = ref(false)
  let loadingTimer: ReturnType<typeof setTimeout>
  const config = useConfig() as Ref<PageConfigSource>
  const loadingEndpoint = computed(() => {
    return marketSnapshot.value?.registry || config.value.market?.search?.endpoint || 'https://registry.koishi.t4wefan.pub/index.json'
  })
  const loadingTimeout = computed(() => {
    const timeout = config.value.market?.search?.timeout
    if (!timeout) return ''
    if (typeof timeout === 'number') return timeout >= 1000 ? `${Math.round(timeout / 1000)}s` : `${timeout}ms`
    return String(timeout)
  })
  const loadingAutoRoute = computed(() => config.value.market?.search?.autoRoute !== false)
  const showMarketCacheHint = computed(() => config.value.market?.search?.logLevel !== 'silent')
  function scheduleLoadingWarning() {
    clearTimeout(loadingTimer)
    if (!marketLoading.value) return
    loadingTimer = setTimeout(() => {
      if (marketLoading.value) loadingSlow.value = true
    }, 8000)
  }
  return {
    marketLoading,
    loadingSlow,
    loadingTimer,
    loadingEndpoint,
    loadingTimeout,
    loadingAutoRoute,
    showMarketCacheHint,
    scheduleLoadingWarning,
  }
}

/** 动作面：安装/升级按钮的类型文案与打开插件行为。 */
function useMarketActions() {
  const { t } = useMarketNextI18n()
  const clientDebug = ref<MarketDebug>({})
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
  function updateClientDebug(value: typeof clientDebug.value) {
    clientDebug.value = value
  }
  return { clientDebug, getType, getText, openPackage, updateClientDebug }
}

/** 市场页主状态：组合各数据/加载/动作面并注入 kConfig 与页面上下文。 */
export function useMarketPage() {
  const dataState = useMarketDataState()
  const loadingState = useMarketLoadingState()
  const actions = useMarketActions()
  provide(kConfig, { installed: global.static ? undefined : installed })
  const { locale } = useMarketNextI18n()
  const page: MarketPageState = {
    words: dataState.words,
    visibleData: dataState.visibleData,
    marketGravatar: dataState.marketGravatar,
    clientDebug: actions.clientDebug,
    showMarketCacheHint: loadingState.showMarketCacheHint,
    formatTime: (value: number) => new Date(value).toLocaleString(locale.value),
    getType: actions.getType,
    getText: actions.getText,
    openPackage: actions.openPackage,
    updateClientDebug: actions.updateClientDebug,
  }
  provide(marketPageContextKey, page)

  watch(loadingState.marketLoading, (loading) => {
    loadingState.loadingSlow.value = false
    clearTimeout(loadingState.loadingTimer)
    if (loading) loadingState.scheduleLoadingWarning()
  }, { immediate: true })
  watch(() => marketSnapshot.value?.dataVersion, (version, previous) => {
    if (version == null || version === previous) return
    void loadMarketSnapshot().catch(error => console.error('[market-next] failed to refresh market index', error))
  })
  onMounted(() => {
    loadingState.scheduleLoadingWarning()
    void loadMarketSnapshot().catch(error => console.error('[market-next] failed to load market index', error))
  })
  onUnmounted(() => clearTimeout(loadingState.loadingTimer))

  return { ...dataState, ...loadingState, ...actions, modeClass: dataState.modeClass }
}
