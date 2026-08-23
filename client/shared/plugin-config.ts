/**
 * @file market-next 插件配置与前端持久化数据的读写层(shared 域)。
 *
 * 模块职责:
 * - 从 store.config.plugins 里定位本插件的配置节点(findMarketNextConfig),
 *  并在其上提供一组类型化的读取器(前端模式/依赖布局/静音过滤规则/更新策略等);
 * - 维护 store.marketData(本插件私有的前端数据:待应用 override、更新忽略
 *  记录、合包记录、折叠分组),提供 patchMarketNextConfig/Data 双写
 *  (本地立即生效 + RPC 同步服务端持久化);
 * - 更新忽略(update ignore)族函数:基于 src/shared/update 的共享逻辑,
 *  判断某包的新版本是否被用户显式忽略。
 *
 * 关键设计:
 * - 静音过滤有三代配置形态(marketSilentFilters 字符串 → 四组结构化规则 →
 *  marketSilentRules 扁平规则),读取时按"最新形态优先"逐级回退;
 * - store.marketData 缺失时落到本地 reactive 兜底对象,保证任何读取都有返回。
 */

import { reactive, ref } from 'vue'
import { send, store } from '@koishijs/client'
import { gt } from 'semver'
import { translate } from './i18n'
import {
  getUpdateCandidates as getSharedUpdateCandidates,
  isUpdateCheckDisabled,
  isUpdateVersionIgnored,
  normalizeUpdateIgnoreCount,
  normalizeUpdateIgnoreRule,
  type IgnoredUpdates,
  type UpdateIgnoreRule,
} from '../../src/shared/update'
import { isLocalDependency } from '../../src/shared/dependency-source'
import type {
  MarketSilentCustomRule,
  MarketSilentDateRule,
  MarketSilentRecentRule,
  MarketSilentRule,
  MarketSilentStatusRule,
} from '../../src/shared/types'

export type { IgnoredUpdates, UpdateIgnoreRule } from '../../src/shared/update'

export { isUpdateCheckDisabled }

/** 市场条目弹层当前打开的包名(空串表示关闭);安装开始前会被清空。 */
export const active = ref('')

/** 前端渲染模式:performance(默认,精简) / polished(动效增强)。 */
export type FrontendMode = 'performance' | 'polished'
/** 依赖页布局:grid(卡片网格,默认) / list(列表)。 */
export type LayoutMode = 'grid' | 'list'

/** 可通过 patchMarketNextConfig 下发的插件配置补丁形态。 */
export interface MarketNextConfigPatch extends UpdatePolicy {
  frontendMode?: FrontendMode
  depsLayout?: LayoutMode
  marketSilentStatusRules?: MarketSilentStatusRule[]
  marketSilentDateRules?: MarketSilentDateRule[]
  marketSilentRecentRules?: MarketSilentRecentRule[]
  marketSilentCustomRules?: MarketSilentCustomRule[]
  marketSilentRules?: MarketSilentRule[]
  marketSilentFilters?: string
  idleProbe?: boolean
  idleProbeDelay?: number
  idleProbeBootDelay?: number
  idleProbeInterval?: number
  bulkMode?: boolean
  removeConfig?: boolean
  bundleRecords?: Record<string, any>
}

// 用 type 交叉而非 interface：调用方多处把它传给 Record<string, any> 参数，
// 接口类型没有隐式 index signature 会报错，type 别名有
export type MarketNextConfig = MarketNextConfigPatch & {
  gravatar?: string
  search?: {
    endpoint?: string
    timeout?: number
    autoRoute?: boolean
    logLevel?: string
  }
}

/** 创建忽略规则时的附加选项(覆盖策略里的默认时长/次数)。 */
export interface UpdateIgnoreOptions {
  duration?: number
  count?: number
}

/** 更新策略:忽略记录 + 三个全局开关(哪些包禁检/忽略时长/忽略版本数/预发布)。 */
export interface UpdatePolicy {
  updateIgnored?: IgnoredUpdates
  updateIgnoredPackages?: string
  updateIgnoreDuration?: number
  updateIgnoreVersions?: number
  updateIgnorePrerelease?: boolean
}

/** 本插件在前端的数据仓(store.marketData)形态,由服务端持久化回发。 */
export interface MarketNextDataStore {
  /** 待应用的依赖变更:包名 → 版本请求(空串表示待卸载)。 */
  override?: Record<string, string>
  /** 各包的更新忽略规则。 */
  updateIgnored?: IgnoredUpdates
  /** 合包安装记录。 */
  bundleRecords?: Record<string, any>
  /** 依赖页各分组的折叠状态。 */
  collapsedGroups?: Record<string, boolean>
}

/** store.marketData 缺失时的本地兜底仓(非持久化,仅保证读取不空)。 */
const fallbackMarketData = reactive<MarketNextDataStore>({
  override: {},
  updateIgnored: {},
  bundleRecords: {},
  collapsedGroups: {},
})

/** 取本插件的数据仓:优先 store.marketData(服务端已推送),否则就地初始化。 */
function getMarketDataStore(): MarketNextDataStore {
  return ((store as any).marketData ||= fallbackMarketData)
}

/** 待应用的依赖 override 表:包名 → 版本请求('' 表示待卸载)。 */
export function getPendingOverrides() {
  const data = getMarketDataStore()
  data.override ||= {}
  return data.override
}

/** 依赖页分组的折叠状态表:分组 key → 是否折叠。 */
export function getCollapsedGroups() {
  const data = getMarketDataStore()
  data.collapsedGroups ||= {}
  return data.collapsedGroups
}

/** 校验前端模式取值,非法输入返回 undefined(由调用方回退默认值)。 */
function normalizeFrontendMode(value: unknown): FrontendMode | undefined {
  return value === 'polished' || value === 'performance' ? value : undefined
}

/**
 * 当前前端渲染模式。数据源是 store 里的插件配置(参数 config 仅为兼容
 * 既有调用签名,不参与判定),未配置或插件未安装时默认 performance。
 */
export function getFrontendMode(config?: { market?: { frontendMode?: FrontendMode } }): FrontendMode {
  const pluginConfig = getMarketNextConfig()
  if (pluginConfig) return normalizeFrontendMode(pluginConfig.frontendMode) ?? 'performance'
  return 'performance'
}

/** 依赖页布局:读取插件配置,默认 grid。 */
export function getDepsLayout(config?: { market?: { depsLayout?: LayoutMode } }): LayoutMode {
  const pluginConfig = getMarketNextConfig()
  if (pluginConfig) return pluginConfig.depsLayout === 'list' ? 'list' : 'grid'
  return 'grid'
}

interface SilentConfig {
  market?: {
    marketSilentStatusRules?: MarketSilentStatusRule[]
    marketSilentDateRules?: MarketSilentDateRule[]
    marketSilentRecentRules?: MarketSilentRecentRule[]
    marketSilentCustomRules?: MarketSilentCustomRule[]
    marketSilentRules?: MarketSilentRule[]
    marketSilentFilters?: string
  }
}

/**
 * 把静音过滤配置转成多行查询词字符串(每行一条,供搜索框回显)。
 * 优先级:扁平规则 marketSilentRules > 四组结构化规则 > 原始字符串
 * marketSilentFilters;三者都没配置时返回空串。
 */
export function getMarketSilentFilters(config?: SilentConfig) {
  const pluginConfig = getMarketNextConfig()
  if (hasOwn(pluginConfig, 'marketSilentRules')) {
    return rulesToSilentFilters(Array.isArray(pluginConfig.marketSilentRules) ? pluginConfig.marketSilentRules : []).join('\n')
  }
  if (hasNewSilentRuleConfig(pluginConfig)) {
    return structuredSilentRulesToFilters(pluginConfig).join('\n')
  }
  if (hasOwn(pluginConfig, 'marketSilentFilters')) {
    return String(pluginConfig.marketSilentFilters ?? '')
  }
  return ''
}

/**
 * 把静音过滤配置转成查询词数组(市场页据此做 getSilentFiltered 预过滤)。
 * 优先级同 getMarketSilentFilters。
 */
export function getMarketSilentRules(config?: SilentConfig) {
  const pluginConfig = getMarketNextConfig()
  if (hasOwn(pluginConfig, 'marketSilentRules')) return rulesToSilentFilters(Array.isArray(pluginConfig.marketSilentRules) ? pluginConfig.marketSilentRules : [])
  if (hasNewSilentRuleConfig(pluginConfig)) return structuredSilentRulesToFilters(pluginConfig)
  return []
}

/** 四组结构化静音规则里任意一组有内容即视为"新形态配置已启用"。 */
function hasNewSilentRuleConfig(config?: Record<string, any>) {
  return hasConfiguredSilentRules(config?.marketSilentStatusRules)
    || hasConfiguredSilentRules(config?.marketSilentDateRules)
    || hasConfiguredSilentRules(config?.marketSilentRecentRules)
    || hasConfiguredSilentRules(config?.marketSilentCustomRules)
}

/** 非空数组才算"已配置"(undefined/空数组都视为未配置)。 */
function hasConfiguredSilentRules(value: unknown) {
  return Array.isArray(value) && value.length > 0
}

/** 四组结构化规则全部转平并合并成查询词数组。 */
function structuredSilentRulesToFilters(config?: SilentConfig['market']) {
  return [
    ...statusRulesToFilters(config?.marketSilentStatusRules ?? []),
    ...dateRulesToFilters(config?.marketSilentDateRules ?? []),
    ...recentRulesToFilters(config?.marketSilentRecentRules ?? []),
    ...customRulesToFilters(config?.marketSilentCustomRules ?? []),
  ]
}

/** 状态规则 → `is:xxx` 查询词(enabled=false 或缺 target 的丢弃)。 */
function statusRulesToFilters(rules: MarketSilentStatusRule[]) {
  return rules
    .filter(rule => rule?.enabled !== false && rule.target)
    .map(rule => `is:${rule.target}`)
}

/** 日期规则 → `created:<2020-01-01` 形态(日期格式不合法的丢弃)。 */
function dateRulesToFilters(rules: MarketSilentDateRule[]) {
  return rules
    .filter(rule => rule?.enabled !== false && rule.field && rule.relation && isDateString(rule.date))
    .map((rule) => `${rule.field}:${rule.relation === 'before' ? '<' : '>'}${rule.date}`)
}

/** 近期规则 → `created:within:30` 形态(days 必须为正数)。 */
function recentRulesToFilters(rules: MarketSilentRecentRule[]) {
  return rules
    .filter(rule => rule?.enabled !== false && rule.field && Number.isFinite(rule.days) && rule.days! > 0)
    .map(rule => `${rule.field}:within:${Math.floor(rule.days!)}`)
}

/** 自定义规则 → 原样输出查询词(去空白)。 */
function customRulesToFilters(rules: MarketSilentCustomRule[]) {
  return rules
    .filter(rule => rule?.enabled !== false)
    .map(rule => String(rule.query ?? '').trim())
    .filter(Boolean)
}

/** 严格校验 YYYY-MM-DD 字符串。 */
function isDateString(value?: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')
}

/** 扁平规则数组 → 有效查询词数组(enabled=false 与转换失败的丢弃)。 */
function rulesToSilentFilters(rules: MarketSilentRule[]) {
  return rules
    .filter(rule => rule?.enabled !== false)
    .map(rule => ruleToSilentFilter(rule))
    .filter(Boolean)
}

/**
 * 单条扁平规则 → 查询词。value 字段按规则类型被复用为 date/days/query
 * 的兜底来源;无法转换(日期非法、天数非正整数等)返回空串由上层过滤。
 */
function ruleToSilentFilter(rule: MarketSilentRule) {
  const value = String(rule.value ?? '').trim()
  const date = String(rule.date ?? value).trim()
  const days = rule.days == null ? value : String(rule.days)
  const query = String(rule.query ?? value).trim()
  switch (rule.type) {
    case 'preview': return 'is:preview'
    case 'insecure': return 'is:insecure'
    case 'bundle': return 'is:bundle'
    case 'created-before': return isDateString(date) ? `created:<${date}` : ''
    case 'created-after': return isDateString(date) ? `created:>${date}` : ''
    case 'updated-before': return isDateString(date) ? `updated:<${date}` : ''
    case 'updated-after': return isDateString(date) ? `updated:>${date}` : ''
    case 'created-within': return isPositiveInteger(days) ? `created:within:${Math.floor(Number(days))}` : ''
    case 'updated-within': return isPositiveInteger(days) ? `updated:within:${Math.floor(Number(days))}` : ''
    case 'custom':
    default:
      return query
  }
}

/** 字符串形式的无符号正整数判定(within:N 类规则的入参校验)。 */
function isPositiveInteger(value?: string) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 && Math.floor(number) === number
}

/** 从 store.config.plugins 里定位本插件的配置节点;插件未配置时为 undefined。 */
export function getMarketNextConfig(): MarketNextConfig | undefined {
  return findMarketNextConfig((store as any).config?.plugins)
}

/**
 * 当前生效的更新策略:全局开关取自插件配置(只挑已显式配置的键),
 * 逐包忽略记录(updateIgnored)始终以数据仓为准。
 */
export function getMarketNextPolicy(fallback?: { market?: UpdatePolicy }): UpdatePolicy {
  const pluginConfig = getMarketNextConfig()
  const data = getMarketDataStore()
  return {
    ...pickExisting(pluginConfig, [
      'updateIgnoredPackages',
      'updateIgnoreDuration',
      'updateIgnoreVersions',
      'updateIgnorePrerelease',
    ] satisfies Array<keyof UpdatePolicy>),
    updateIgnored: data.updateIgnored ?? {},
  }
}

/**
 * 可写形态的更新策略:把数据仓的 updateIgnored 同步进插件配置节点再返回,
 * 调用方对返回值的修改会直接反映到配置面板与后续 getMarketNextConfig 读取。
 */
export function getWritableMarketNextPolicy(fallback?: { market?: UpdatePolicy }): UpdatePolicy {
  const pluginConfig = getMarketNextConfig()
  const data = getMarketDataStore()
  data.updateIgnored ||= {}
  if (!pluginConfig) return { updateIgnored: data.updateIgnored }
  pluginConfig.updateIgnored = data.updateIgnored
  return pluginConfig
}

/** 批量模式开关(依赖页批量选择);未配置默认关闭。 */
export function getBulkMode(fallback?: { market?: { bulkMode?: boolean } }) {
  const pluginConfig = getMarketNextConfig()
  if (hasOwn(pluginConfig, 'bulkMode')) {
    return !!pluginConfig.bulkMode
  }
  return false
}

/** 卸载依赖时是否顺带删除插件配置;未配置返回 undefined(由调用方决定)。 */
export function getRemoveConfig(fallback?: { market?: { removeConfig?: boolean } }) {
  const pluginConfig = getMarketNextConfig()
  if (hasOwn(pluginConfig, 'removeConfig')) {
    return pluginConfig.removeConfig
  }
  return undefined
}

/** 合包安装记录(只读视图;数据仓缺失时返回空对象)。 */
export function getBundleRecords(fallback?: { market?: { bundleRecords?: Record<string, any> } }) {
  return getMarketDataStore().bundleRecords ?? {}
}

/** 合包安装记录的可写引用(直接改它再 patchMarketNextData 持久化)。 */
export function getWritableBundleRecords(fallback?: { market?: { bundleRecords?: Record<string, any> } }) {
  const data = getMarketDataStore()
  data.bundleRecords ||= {}
  return data.bundleRecords
}

/**
 * 更新插件配置:本地配置节点立即合并(配置面板即时生效),再异步发
 * market/update-config RPC 让服务端持久化;请求失败只告警并返回 false。
 */
export function patchMarketNextConfig(patch: Partial<MarketNextConfigPatch>) {
  const pluginConfig = getMarketNextConfig()
  if (pluginConfig) Object.assign(pluginConfig, patch)
  const task = send('market/update-config', patch)
  if (!task) return Promise.resolve(false)
  return task.catch((error) => {
    console.error(error)
    return false
  })
}

/**
 * 更新前端数据仓:本地立即合并,再发 market/update-data RPC;服务端会
 * 返回规整后的完整数据(含其他标签页的写入),回填本地保证多端一致。
 */
export function patchMarketNextData(patch: Partial<MarketNextDataStore>) {
  const data = getMarketDataStore()
  Object.assign(data, patch)
  const task = send('market/update-data', patch)
  if (!task) return Promise.resolve(false)
  return task.then((next: MarketNextDataStore) => {
    Object.assign(data, next)
    return true
  }).catch((error) => {
    console.error(error)
    return false
  })
}

/**
 * 为某包创建"忽略此更新"规则:目标是当前最新的未忽略版本,时长/次数
 * 先取本次 options,缺省回落到策略里的全局配置。取不到版本返回 undefined。
 */
export function createUpdateIgnoreRule(name: string, policy?: UpdatePolicy, options: UpdateIgnoreOptions = {}): UpdateIgnoreRule | undefined {
  const version = getLatestVersion(name, policy)
  if (!version) return
  const duration = Math.max(0, options.duration ?? policy?.updateIgnoreDuration ?? 0)
  const count = normalizeUpdateIgnoreCount(options.count ?? policy?.updateIgnoreVersions)
  const now = Date.now()
  return {
    version,
    count,
    ignoredAt: now,
    until: duration ? now + duration : undefined,
  }
}

/** 某包当前应升级到的版本:更新候选里第一个未被忽略的(候选已按版本降序)。 */
export function getLatestVersion(name: string, policy?: UpdatePolicy) {
  const candidates = getUpdateCandidates(name, policy)
  return candidates.find(version => !isUpdateVersionIgnored(name, version, candidates, policy))
}

/** 最新版本恰好被忽略时返回该版本(用于"已忽略"标记),否则 undefined。 */
export function getIgnoredUpdateVersion(name: string, policy?: UpdatePolicy) {
  if (isUpdateCheckDisabled(name, policy)) return
  const latest = getUpdateCandidates(name, policy)[0]
  if (!latest || !isVersionIgnored(name, latest, policy)) return
  return latest
}

/** 把忽略规则格式成用户可读文案(忽略的版本 + 剩余次数 + 截止时间)。 */
export function getUpdateIgnoreText(name: string, policy?: UpdatePolicy) {
  const rule = normalizeUpdateIgnoreRule(policy?.updateIgnored?.[name])
  if (!rule?.version) return ''
  const parts = [translate('common.ignore.version', { version: rule.version })]
  if (rule.count && rule.count > 1) parts.push(translate('common.ignore.count', { count: rule.count }))
  if (rule.until) parts.push(translate('common.ignore.until', { time: new Date(rule.until).toLocaleString() }))
  return parts.join(translate('common.ignore.separator'))
}

/** 某包的最新版本是否处于被忽略状态。 */
export function isUpdateIgnored(name: string, policy?: UpdatePolicy) {
  return !!getIgnoredUpdateVersion(name, policy)
}

/** 某包是否有可升级的新版本(最新版比已装的高,且不在忽略之列;本地依赖不算)。 */
export function hasUpdate(name: string, policy?: UpdatePolicy) {
  const latest = getLatestVersion(name, policy)
  const local = store.dependencies?.[name]
  if (!latest || isLocalDependency(local)) return
  try {
    return gt(latest, local.resolved)
  } catch {}
}

/**
 * 某包的升级候选版本列表:本地依赖(file/link 装的)无候选,其余从
 * registry 元数据的版本号里筛出比已装版本新的,交由共享逻辑排序过滤。
 */
function getUpdateCandidates(name: string, policy?: UpdatePolicy) {
  const local = store.dependencies?.[name]
  if (isLocalDependency(local)) return []
  return getSharedUpdateCandidates(Object.keys(store.registry?.[name] ?? {}), local?.resolved, policy)
}

/** 指定版本是否被该包的忽略规则覆盖(次数/时长/精确版本匹配)。 */
function isVersionIgnored(name: string, version: string, policy?: UpdatePolicy) {
  const candidates = getUpdateCandidates(name, policy)
  return isUpdateVersionIgnored(name, version, candidates, policy)
}

/**
 * 在插件配置树里递归查找本插件的节点:
 * - 键以 $ 开头的是注释/元信息,跳过;
 * - 键以 ~ 开头表示插件被禁用,记作 fallback 备选;
 * - 支持嵌套在 group 分组里的配置;
 * 优先返回启用节点的配置,全部被禁用时返回最后一个禁用节点(保证还能读写)。
 */
function findMarketNextConfig(plugins: any): any {
  let fallback: any

  function visit(object: any): any {
    if (!object || typeof object !== 'object') return
    for (const rawKey of Object.keys(object)) {
      if (rawKey.startsWith('$')) continue
      const value = object[rawKey]
      if (!value || typeof value !== 'object') continue
      const disabled = rawKey.startsWith('~')
      const key = disabled ? rawKey.slice(1) : rawKey
      const name = key.split(':', 1)[0]
      if (name === 'market-next' || name === 'koishi-plugin-marketn-refactored') {
        if (!disabled) return value
        fallback ||= value
      }
      if (name !== 'group') continue
      const nested = visit(value)
      if (nested) return nested
    }
  }

  return visit(plugins) ?? fallback
}

/** 从对象里挑出"显式存在"的键组成子对象(undefined 但存在的键会保留)。 */
function pickExisting<T extends object, K extends keyof T>(source: T, keys: K[]): Partial<Pick<T, K>> {
  const result: Partial<Pick<T, K>> = {}
  for (const key of keys) {
    if (hasOwn(source, key)) {
      result[key] = source[key]
    }
  }
  return result
}

/** Object.prototype.hasOwnProperty 的类型安全包装,并收窄 undefined 源。 */
function hasOwn<T extends object, K extends PropertyKey>(source: T | undefined, key: K): source is T & Record<K, unknown> {
  return !!source && Object.prototype.hasOwnProperty.call(source, key)
}
