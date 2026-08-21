import { send, store } from '@koishijs/client'
import type { IgnoredUpdates } from '../../src/shared/update'
import { getMarketDataStore } from './data-store'

export type FrontendMode = 'performance' | 'polished'
export type LayoutMode = 'grid' | 'list'

export interface MarketSilentStatusRule {
  target?: 'preview' | 'insecure' | 'bundle'
  note?: string
  enabled?: boolean
}

export interface MarketSilentDateRule {
  field?: 'created' | 'updated'
  relation?: 'before' | 'after'
  date?: string
  note?: string
  enabled?: boolean
}

export interface MarketSilentRecentRule {
  field?: 'created' | 'updated'
  days?: number
  note?: string
  enabled?: boolean
}

export interface MarketSilentCustomRule {
  query?: string
  note?: string
  enabled?: boolean
}

export interface MarketSilentRule {
  type?: 'custom' | 'preview' | 'insecure' | 'bundle' | 'created-before' | 'created-after' | 'updated-before' | 'updated-after' | 'created-within' | 'updated-within'
  value?: string
  date?: string
  days?: number
  query?: string
  note?: string
  enabled?: boolean
}

export interface UpdateIgnoreOptions {
  duration?: number
  count?: number
}

export interface UpdatePolicy {
  updateIgnored?: IgnoredUpdates
  updateIgnoredPackages?: string
  updateIgnoreDuration?: number
  updateIgnoreVersions?: number
  updateIgnorePrerelease?: boolean
}

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

export function normalizeFrontendMode(value: unknown): FrontendMode | undefined {
  return value === 'polished' || value === 'performance' ? value : undefined
}

export function getFrontendMode(config?: { market?: { frontendMode?: FrontendMode } }): FrontendMode {
  const pluginConfig = getMarketNextConfig()
  if (pluginConfig) return normalizeFrontendMode(pluginConfig.frontendMode) ?? 'performance'
  return 'performance'
}

export function getDepsLayout(config?: { market?: { depsLayout?: LayoutMode } }): LayoutMode {
  const pluginConfig = getMarketNextConfig()
  if (pluginConfig) return pluginConfig.depsLayout === 'list' ? 'list' : 'grid'
  return 'grid'
}

export function getMarketNextConfig(): MarketNextConfig | undefined {
  return findMarketNextConfig((store as any).config?.plugins)
}

export function getBulkMode(fallback?: { market?: { bulkMode?: boolean } }) {
  const pluginConfig = getMarketNextConfig()
  if (hasOwn(pluginConfig, 'bulkMode')) {
    return !!pluginConfig.bulkMode
  }
  return false
}

export function getRemoveConfig(fallback?: { market?: { removeConfig?: boolean } }) {
  const pluginConfig = getMarketNextConfig()
  if (hasOwn(pluginConfig, 'removeConfig')) {
    return pluginConfig.removeConfig
  }
  return undefined
}

export function getMarketNextPolicy(fallback?: { market?: UpdatePolicy }): UpdatePolicy {
  const pluginConfig = getMarketNextConfig()
  const data = getMarketDataStore()
  return {
    ...pickExisting(pluginConfig ?? {}, [
      'updateIgnoredPackages',
      'updateIgnoreDuration',
      'updateIgnoreVersions',
      'updateIgnorePrerelease',
    ] satisfies Array<keyof UpdatePolicy>),
    updateIgnored: data.updateIgnored ?? {},
  }
}

export function getWritableMarketNextPolicy(fallback?: { market?: UpdatePolicy }): UpdatePolicy {
  const pluginConfig = getMarketNextConfig()
  const data = getMarketDataStore()
  data.updateIgnored ||= {}
  if (!pluginConfig) return { updateIgnored: data.updateIgnored }
  pluginConfig.updateIgnored = data.updateIgnored
  return pluginConfig
}

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

function pickExisting<T extends object, K extends keyof T>(source: T, keys: K[]): Partial<Pick<T, K>> {
  const result: Partial<Pick<T, K>> = {}
  for (const key of keys) {
    if (hasOwn(source, key)) {
      result[key] = source[key]
    }
  }
  return result
}

export function hasOwn<T extends object, K extends PropertyKey>(source: T | undefined, key: K): source is T & Record<K, unknown> {
  return !!source && Object.prototype.hasOwnProperty.call(source, key)
}
