/**
 * @file 市场页的数据管线与加载态 composable(market 页域)。
 *
 * 快照全量数据 → 静音过滤 → 可见性过滤的三级管线;加载态判定
 * (shallowRef/store 两路);慢加载 8 秒计时;搜索词与 URL ?keyword=
 * 双向同步(180ms 去抖);服务端 dataVersion 前进时重拉快照。
 */

import { computed, ref, watch } from 'vue'
import { global, router, store } from '@koishijs/client'
import type { SearchObject } from '@koishijs/registry'
import { getMarketSilentFilters, getMarketSilentRules } from '../../shared/plugin-config'
import { getSilentFiltered, getVisible, parseSilentFilters } from '../../market'
import {
  getMarketSnapshotData,
  loadMarketSnapshot,
  marketSnapshot,
  marketSnapshotError,
  marketSnapshotLoading,
} from '../../market/state'

/** installed 判定:优先 store.packages,静态站点模式退化为 dependencies。 */
export function installed(data: SearchObject) {
  if (store.packages) {
    return !!store.packages[data.package.name]
  } else {
    return !!store.dependencies?.[data.package.name]
  }
}

export function useMarketPage(config: { value: any }) {
  /** 查询词表(与搜索框、筛选栏、列表共用)。 */
  const words = ref<string[]>([''])
  /** 已提交词表拼接的搜索串(URL 同步用)。 */
  const prompt = computed(() => words.value.filter(w => w).join(' '))

  /** 静音过滤规则(三代配置形态归一后的结果,见 plugin-config)。 */
  const silentFilters = computed(() => {
    const rules = getMarketSilentRules(config.value)
    if (rules.length) return rules
    return parseSilentFilters(getMarketSilentFilters(config.value))
  })

  /** 快照全量数据。 */
  const data = computed(() => Object.values(getMarketSnapshotData()))
  /** 静音过滤后的数据(隐藏用户配置中标记静音的条目)。 */
  const silentData = computed(() => getSilentFiltered(data.value, silentFilters.value, {
    installed: global.static ? undefined : installed,
  }))

  /** 可见性开关词状态(show:hidden / show:deprecated)。 */
  const visibilityMode = computed(() => {
    return `${words.value.includes('show:hidden') ? 1 : 0}:${words.value.includes('show:deprecated') ? 1 : 0}`
  })

  /** 可见性过滤后的数据:传给筛选栏(计数)与列表(visibility-prepared)。 */
  const visibleData = computed(() => {
    const [hidden, deprecated] = visibilityMode.value.split(':')
    const visibilityWords = [
      hidden === '1' ? 'show:hidden' : '',
      deprecated === '1' ? 'show:deprecated' : '',
    ].filter(Boolean)
    return getVisible(silentData.value, visibilityWords)
  })

  /**
   * 是否处于加载态:有数据或有错误即结束;真正在拉取(shallowRef 或
   * store 标记 loading)时为 true;两边都没有数据但 total>0(数据还在
   * 服务端没下发)也视为加载中。
   */
  const marketLoading = computed(() => {
    if (data.value.length) return false
    if (marketSnapshotError.value) return false
    if (marketSnapshotLoading.value) return true
    const state = marketSnapshot.value ?? store.market
    if (!state || state.loading) return true
    const hasResolvedSnapshot = !!marketSnapshot.value || !!store.market?.data
    return !hasResolvedSnapshot && (state.total ?? 0) > 0
  })

  /** 加载超过 8 秒后置 true,显示慢加载警告。 */
  const loadingSlow = ref(false)
  let loadingTimer: ReturnType<typeof setTimeout>

  /** 当前使用的 registry 端点(提示文案用)。 */
  const loadingEndpoint = computed(() => {
    return store.market?.registry || config.value.market?.search?.endpoint || 'https://registry.koishi.t4wefan.pub/index.json'
  })

  /** 超时配置的可读形态(ms/s)。 */
  const loadingTimeout = computed(() => {
    const timeout = config.value.market?.search?.timeout
    if (!timeout) return ''
    if (typeof timeout === 'number') return timeout >= 1000 ? `${Math.round(timeout / 1000)}s` : `${timeout}ms`
    return String(timeout)
  })

  /** 是否启用端点自动路由(提示文案用,默认开启)。 */
  const loadingAutoRoute = computed(() => config.value.market?.search?.autoRoute !== false)

  /** 是否显示缓存提示(logLevel=silent 时隐藏)。 */
  const showMarketCacheHint = computed(() => config.value.market?.search?.logLevel !== 'silent')

  /** 慢加载计时:加载持续超过 8 秒置 loadingSlow。 */
  function scheduleLoadingWarning() {
    clearTimeout(loadingTimer)
    if (!marketLoading.value) return
    loadingTimer = setTimeout(() => {
      if (marketLoading.value) loadingSlow.value = true
    }, 8000)
  }

  // URL ?keyword= → 词表(外部跳转带搜索词进入市场页)
  watch(router.currentRoute, (value) => {
    if (value.path !== '/market') return
    const { keyword } = value.query
    if (keyword === prompt.value) return
    words.value = Array.isArray(keyword) ? keyword : (keyword || '').split(' ')
    words.value = words.value.map(w => w.toLowerCase())
    if (words.value[words.value.length - 1]) words.value.push('')
  }, { immediate: true, deep: true })

  let routeSyncTimer: ReturnType<typeof setTimeout>

  // 词表 → URL ?keyword=(180ms 去抖,用 replace 不产生历史记录)
  watch(prompt, (value) => {
    clearTimeout(routeSyncTimer)
    routeSyncTimer = setTimeout(() => {
      const { keyword: _, ...rest } = router.currentRoute.value.query
      if (value === (router.currentRoute.value.query.keyword || '')) return
      if (value) {
        router.replace({ query: { keyword: value, ...rest } })
      } else {
        router.replace({ query: rest })
      }
    }, 180)
  }, { deep: true })

  // 加载态变化时重启慢加载计时(8 秒后告警)
  watch(marketLoading, (loading) => {
    loadingSlow.value = false
    clearTimeout(loadingTimer)
    if (loading) scheduleLoadingWarning()
  }, { immediate: true })

  // 服务端刷新了市场索引(dataVersion 前进)→ 重拉快照拿新数据
  watch(() => store.market?.dataVersion, (version, previous) => {
    if (version == null || version === previous) return
    void loadMarketSnapshot().catch(error => console.error('[market-next] failed to refresh market index', error))
  })

  /** 初始加载入口(onMounted 调用)与清理(onUnmounted 调用)。 */
  function loadInitial() {
    scheduleLoadingWarning()
    void loadMarketSnapshot().catch(error => console.error('[market-next] failed to load market index', error))
  }

  function dispose() {
    clearTimeout(loadingTimer)
    clearTimeout(routeSyncTimer)
  }

  return {
    words, data, silentData, visibleData, marketLoading, loadingSlow,
    loadingEndpoint, loadingTimeout, loadingAutoRoute, showMarketCacheHint,
    loadInitial, dispose,
  }
}
