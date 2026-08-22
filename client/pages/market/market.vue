<template>
  <k-layout main="darker" :class="['page-market', modeClass]" menu="market">
    <!-- 左侧栏:排序/徽章/高级日期/分类筛选 -->
    <template #left>
      <el-scrollbar>
        <market-filter v-model="words" :data="visibleData"></market-filter>
      </el-scrollbar>
    </template>

    <!-- 加载态:市场索引拉取中;超过 8 秒追加慢加载提示与设置入口 -->
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

    <!-- 主体:搜索行,命中彩蛋关键词时整页切换为秘密档案,否则渲染列表 -->
    <el-scrollbar ref="root" v-else-if="data.length">
      <div class="market-search-row">
        <market-search ref="searchBox" v-model="words"></market-search>
      </div>
      <market-secret-archive
        v-if="secretSearchMatched"
        :koishi-version="secretArchiveKoishiVersion"
        :market-count="secretArchiveMarketCount"
        :recorded-at="secretArchiveRecordedAt"
      ></market-secret-archive>
      <market-list
        v-else
        v-model="words"
        :data="visibleData"
        visibility-prepared
        :gravatar="marketGravatar"
        :debug="!!store.market.debug"
        @debug="updateClientDebug"
        @update:page="scrollToTop">
        <template #header="{ hasFilter, all, packages }">
          <!-- 统计行:命中数/总数 -->
          <div class="market-hint text-center">
            {{ hasFilter ? t('marketPage.results.filtered', { filtered: packages.length, total: all.length }) : t('marketPage.results.all', { total: all.length }) }}
          </div>
          <!-- 缓存提示:索引已过期(stale)或仍在使用缓存 -->
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
          <!-- 调试面板(开启 debug 时):数据源/体积/压缩比/各阶段耗时/端点评分 -->
          <k-comment v-if="store.market.debug" type="primary" class="market-debug">
            <p>{{ t('marketPage.debug.performance', { source: formatSource(store.market.debug.source), endpoint: store.market.debug.endpoint || store.market.registry || t('marketPage.registry.unknown') }) }}</p>
            <div class="market-debug-grid">
              <span v-for="item in debugItems" :key="item.label" class="market-debug-item">
                <span>{{ item.label }}</span>
                <span>{{ item.value }}</span>
              </span>
            </div>
            <div v-if="debugTimings.length" class="market-debug-timings">
              <span v-for="[key, value] in debugTimings" :key="key">{{ formatTimingName(key) }} {{ formatDuration(value) }}</span>
            </div>
            <div v-if="debugPhases.length" class="market-debug-timings">
              <span v-for="item in debugPhases" :key="item.label">{{ item.label }}: {{ item.value }}</span>
            </div>
            <div v-if="debugRoutes.length" class="market-debug-routes">
              <span v-for="route in debugRoutes" :key="route.endpoint" class="market-debug-route">
                {{ shortEndpoint(route.endpoint) }} score={{ formatScore(route.score) }}
                <template v-if="route.averageElapsed"> avg={{ formatDuration(route.averageElapsed) }}</template>
                <template v-if="route.contentEncoding"> {{ route.contentEncoding }}</template>
                <template v-if="route.cachedAt"> cache={{ formatTime(route.cachedAt) }}</template>
                <template v-if="route.coolingDown"> cooldown={{ formatTime(route.cooldownUntil) }}</template>
              </span>
            </div>
          </k-comment>
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

    <!-- 错误态:市场索引加载失败,引导去设置页检查 registry -->
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
/**
 * @file 市场主页面(/market)。
 *
 * 模块职责:
 * - 组装页面骨架:左侧筛选栏、顶部搜索框、卡片列表、加载/错误/慢加载
 *  提示、缓存提示与调试面板;
 * - 驱动市场快照的加载与刷新(onMounted 拉取、dataVersion 变化重拉);
 * - 搜索词与 URL ?keyword= 双向同步;Ctrl+K 聚焦搜索框;
 * - 卡片操作按钮的文案/类型(按安装状态与 pending override 决定)。
 *
 * 关键设计:
 * - 快照数据来自 market/state.ts(shallowRef + store 兜底),本页只做
 *  静音过滤(getSilentFiltered)与可见性过滤(show:hidden/show:deprecated),
 *  查询词过滤与排序交给 market-list 组件;
 * - 彩蛋:搜索词命中"恋恋世界第一"时整页切换为 market-secret-archive。
 */

import { router, store, global, useConfig } from '@koishijs/client'
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { active, getFrontendMode, getMarketSilentFilters, getMarketSilentRules, getPendingOverrides } from '../../shared/plugin-config'
import { getSilentFiltered, getVisible, kConfig, MarketFilter, MarketList, MarketSearch, parseSilentFilters } from '../../market'
import { SearchObject } from '@koishijs/registry'
import { activeBundle } from '../../shared/operations'
import MarketSecretArchive from './market-secret-archive.vue'
import { canInstallBundleSearchObject } from '../../market/utils'
import {
  getMarketSnapshotData,
  loadMarketSnapshot,
  marketSnapshot,
  marketSnapshotError,
  marketSnapshotLoading,
} from '../../market/state'
import { useMarketNextI18n } from '../../shared/i18n'

/** installed 判定:优先 store.packages,静态站点模式退化为 dependencies。 */
function installed(data: SearchObject) {
  if (store.packages) {
    return !!store.packages[data.package.name]
  } else {
    return !!store.dependencies?.[data.package.name]
  }
}

/** 主滚动容器(滚动回顶用)。 */
const root = ref()
/** 搜索框组件引用(focus 快捷键用)。 */
const searchBox = ref<{ focus?: () => void }>()
const config = useConfig()
const { t, locale } = useMarketNextI18n()
/** 前端渲染模式(驱动根类名 market-mode-*)。 */
const frontendMode = computed(() => getFrontendMode(config.value))
/** gravatar 镜像:插件配置优先,退化为服务端下发的 store.market.gravatar。 */
const marketGravatar = computed(() => config.value.market?.gravatar || store.market?.gravatar)
/** 静音过滤规则(三代配置形态归一后的结果,见 plugin-config.ts)。 */
const silentFilters = computed(() => {
  const rules = getMarketSilentRules(config.value)
  if (rules.length) return rules
  return parseSilentFilters(getMarketSilentFilters(config.value))
})
/** 模式类名(performance/polished)。 */
const modeClass = computed(() => `market-mode-${frontendMode.value}`)

// 注入市场配置:静态站点下不提供 installed 判定
provide(kConfig, {
  installed: global.static ? undefined : installed,
})

/** 查询词表(与搜索框、筛选栏、列表共用)。 */
const words = ref<string[]>([''])

/** 已提交词表拼接的搜索串(URL 同步用)。 */
const prompt = computed(() => words.value.filter(w => w).join(' '))

/** 彩蛋判定:归一化(NFKC)后的搜索内容先含"恋恋"、随后含"世界第一"。 */
const secretSearchMatched = computed(() => {
  const source = words.value.join('').normalize('NFKC')
  const prefixIndex = source.indexOf('恋恋')
  return prefixIndex >= 0 && source.indexOf('世界第一', prefixIndex + 2) >= 0
})

/** 彩蛋档案的"归档时间"(首次触发彩蛋时记录)。 */
const secretArchiveRecordedAt = ref('')

/** 当前 Koishi 版本(依赖表/包表多路兜底),供彩蛋档案展示。 */
const secretArchiveKoishiVersion = computed(() => {
  return store.dependencies?.koishi?.resolved
    || store.packages?.koishi?.package.version
    || store.dependencies?.['@koishijs/core']?.resolved
    || store.packages?.['@koishijs/core']?.package.version
})

// 触发彩蛋时记录时间并滚回顶部
watch(secretSearchMatched, (matched) => {
  if (!matched) return
  secretArchiveRecordedAt.value = new Date().toLocaleString(locale.value)
  requestAnimationFrame(() => root.value?.scrollTo(0, 0))
})

/** 快照全量数据。 */
const data = computed(() => Object.values(getMarketSnapshotData()))

/** 市场总条数:优先服务端 total,退化为本地数据量(彩蛋档案展示)。 */
const secretArchiveMarketCount = computed(() => store.market?.total || data.value.length)

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

/** 列表组件上报的前端调试统计(过滤/排序/虚拟化耗时)。 */
const clientDebug = ref<{
  timings?: Record<string, number>
  total?: number
  matched?: number
  visible?: number
  rendered?: number
}>({})

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

/** 调试面板的键值对条目(对象数/体积/编码/压缩比/端点/前后端统计)。 */
const debugItems = computed(() => {
  const debug = store.market?.debug
  if (!debug) return []
  return [
    [t('marketPage.debug.objectCount'), formatNumber(debug.objects ?? store.market?.total)],
    [t('marketPage.debug.decodedSize'), formatSize(debug.size)],
    [t('marketPage.debug.wireSize'), formatSize(debug.wireSize)],
    [t('marketPage.debug.encoding'), formatEncoding(debug.contentEncoding)],
    [t('marketPage.debug.compressionRatio'), formatCompressionRatio(debug.size, debug.wireSize)],
    [t('marketPage.debug.candidates'), formatNumber(debug.candidates)],
    [t('marketPage.debug.preferredEndpoint'), debug.preferredEndpoint || '-'],
    [t('marketPage.debug.fallbackReason'), formatFallbackReason(debug.fallbackReason)],
    ['Hash', debug.hash || '-'],
    ['ETag', debug.etag || '-'],
    ['Last-Modified', debug.lastModified || '-'],
    [t('marketPage.debug.cacheTime'), debug.cachedAt ? formatTime(debug.cachedAt) : '-'],
    [t('marketPage.debug.validationTime'), debug.validatedAt ? formatTime(debug.validatedAt) : '-'],
    [t('marketPage.debug.frontendMatched'), clientDebug.value.matched == null ? '-' : `${clientDebug.value.matched} / ${clientDebug.value.total ?? '-'}`],
    [t('marketPage.debug.loadedRendered'), clientDebug.value.visible == null ? '-' : `${clientDebug.value.visible} / ${clientDebug.value.rendered ?? '-'}`],
  ].map(([label, value]) => ({ label, value }))
})

/** 调试面板的耗时条目(服务端 timings 与前端 clientDebug 合并)。 */
const debugTimings = computed(() => {
  return Object
    .entries({
      ...(store.market?.debug?.timings ?? {}),
      ...(clientDebug.value.timings ?? {}),
    })
    .filter(([, value]) => typeof value === 'number')
})

/** 调试面板的阶段概览(首次加载/后台刷新两阶段)。 */
const debugPhases = computed(() => {
  const debug = store.market?.debug
  if (!debug) return []
  return [
    [t('marketPage.debug.initial'), debug.initial],
    [t('marketPage.debug.background'), debug.refresh],
  ].filter(([, value]) => value).map(([label, value]) => ({
    label,
    value: formatDebugPhase(value as any),
  }))
})

/** 端点评分排行(前 6 个候选端点的分数/延迟/缓存状态)。 */
const debugRoutes = computed(() => store.market?.debug?.routeScores?.slice(0, 6) ?? [])

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

onMounted(() => {
  scheduleLoadingWarning()
  window.addEventListener('keydown', onSearchShortcut)
  void loadMarketSnapshot().catch(error => console.error('[market-next] failed to load market index', error))
})

onUnmounted(() => {
  clearTimeout(loadingTimer)
  clearTimeout(routeSyncTimer)
  window.removeEventListener('keydown', onSearchShortcut)
})

/** 全局键盘快捷键:Ctrl/Cmd+K 聚焦搜索框;彩蛋页 Esc 清词并聚焦。 */
function onSearchShortcut(event: KeyboardEvent) {
  if (router.currentRoute.value?.path !== '/market') return
  if (event.key === 'Escape' && secretSearchMatched.value) {
    event.preventDefault()
    words.value = ['']
    searchBox.value?.focus?.()
    return
  }
  if (event.key.toLowerCase() !== 'k') return
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  searchBox.value?.focus?.()
}

/** 慢加载计时:加载持续超过 8 秒置 loadingSlow。 */
function scheduleLoadingWarning() {
  clearTimeout(loadingTimer)
  if (!marketLoading.value) return
  loadingTimer = setTimeout(() => {
    if (marketLoading.value) loadingSlow.value = true
  }, 8000)
}

/** 卡片操作按钮颜色:已装绿/待操作黄/待卸载红,未装蓝。 */
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

/** 卡片操作按钮文案:与 getType 的状态机一一对应。 */
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

/** 打开条目详情:可安装的合包打开合包弹层,普通包设置 active 弹层。 */
function openPackage(data: SearchObject) {
  if (!global.static && canInstallBundleSearchObject(data)) {
    activeBundle.value = data
    return
  }
  active.value = data.package.name
}

/** 滚回列表顶部(翻页时由列表触发)。 */
function scrollToTop() {
  root.value?.scrollTo(0, 0)
}

/** 时间戳 → 本地化时间串。 */
function formatTime(value: number) {
  return new Date(value).toLocaleString(locale.value)
}

/** 接收列表组件上报的前端调试统计。 */
function updateClientDebug(value: typeof clientDebug.value) {
  clientDebug.value = value
}

/** 数据来源的网络/磁盘缓存/304/哈希缓存/legacy 枚举翻译。 */
function formatSource(source?: string) {
  const labels: Record<string, string> = {
    'network': t('marketPage.debug.sourceNetwork'),
    'disk-cache': t('marketPage.debug.sourceDiskCache'),
    'http-304': t('marketPage.debug.sourceHttp304'),
    'hash-cache': t('marketPage.debug.sourceHashCache'),
    'legacy': t('marketPage.debug.sourceLegacy'),
  }
  return source ? labels[source] || source : t('marketPage.debug.unknown')
}

/** 耗时项 key → 本地化名称(请求/版本探测/解析/前后端各阶段)。 */
function formatTimingName(name: string) {
  const labels: Record<string, string> = {
    request: t('marketPage.debug.request'),
    version: t('marketPage.debug.versionProbe'),
    hash: 'Hash',
    parse: t('marketPage.debug.parse'),
    apply: t('marketPage.debug.apply'),
    total: t('marketPage.debug.total'),
    cacheRead: t('marketPage.debug.cacheRead'),
    cacheParse: t('marketPage.debug.cacheParse'),
    payloadData: t('marketPage.debug.payloadData'),
    payload: t('marketPage.debug.payload'),
    frontendSort: t('marketPage.debug.frontendSort'),
    frontendFilter: t('marketPage.debug.frontendFilter'),
    frontendVirtual: t('marketPage.debug.frontendVirtual'),
  }
  return labels[name] || name
}

/** 毫秒数 → "Nms"。 */
function formatDuration(value: number) {
  return `${Math.round(value)}ms`
}

/** 阶段概览:来源/端点/回退原因/总耗时/编码/体积拼接成一行。 */
function formatDebugPhase(value: {
  source?: string
  endpoint?: string
  timings?: Record<string, number>
  contentEncoding?: string
  wireSize?: number
  fallbackReason?: string
}) {
  const parts = [
    formatSource(value.source),
    shortEndpoint(value.endpoint),
  ]
  if (value.fallbackReason) parts.push(formatFallbackReason(value.fallbackReason))
  if (value.timings?.total != null) parts.push(formatDuration(value.timings.total))
  if (value.contentEncoding) parts.push(value.contentEncoding)
  if (value.wireSize) parts.push(formatSize(value.wireSize))
  return parts.filter(Boolean).join(' / ')
}

/** 端点回退原因枚举翻译。 */
function formatFallbackReason(value?: string) {
  switch (value) {
    case 'primary-failed': return t('marketPage.debug.primaryFailed')
    case 'primary-slow': return t('marketPage.debug.primarySlow')
    case 'primary-stale': return t('marketPage.debug.primaryStale')
    case 'rescue': return t('marketPage.debug.rescue')
    default: return '-'
  }
}

/** 字节数 → B/KB/MB 文案。 */
function formatSize(value?: number) {
  if (value == null) return '-'
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)}MB`
  if (value > 1024) return `${(value / 1024).toFixed(1)}KB`
  return `${value}B`
}

/** 内容编码展示,缺省 identity(未压缩)。 */
function formatEncoding(value?: string) {
  return value || 'identity'
}

/** 压缩比:解码体积/传输体积;未压缩时显示占位文案。 */
function formatCompressionRatio(decoded?: number, encoded?: number) {
  if (!decoded || !encoded) return '-'
  if (encoded >= decoded) return t('marketPage.debug.uncompressed')
  return `${(decoded / encoded).toFixed(1)}x`
}

/** 端点 URL → 只显示主机名(解析失败原样返回)。 */
function shortEndpoint(value?: string) {
  if (!value) return '-'
  try {
    const url = new URL(value)
    return url.hostname
  } catch {
    return value
  }
}

/** 端点评分 → 一位小数文本。 */
function formatScore(value?: number) {
  return value == null ? '-' : value.toFixed(1)
}

/** 数字 → 千分位文本(空值显示 -)。 */
function formatNumber(value?: number) {
  return value == null ? '-' : value.toLocaleString()
}

</script>

<style lang="scss" src="./market.scss"></style>
