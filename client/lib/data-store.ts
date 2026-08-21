import { reactive } from 'vue'
import { send, store } from '@koishijs/client'
import type { IgnoredUpdates } from '../../src/shared/update'

export interface MarketNextDataStore {
  override?: Record<string, string>
  updateIgnored?: IgnoredUpdates
  bundleRecords?: Record<string, any>
  collapsedGroups?: Record<string, boolean>
}

const fallbackMarketData = reactive<MarketNextDataStore>({
  override: {},
  updateIgnored: {},
  bundleRecords: {},
  collapsedGroups: {},
})

export function getMarketDataStore(): MarketNextDataStore {
  return ((store as any).marketData ||= fallbackMarketData)
}

export function getPendingOverrides() {
  const data = getMarketDataStore()
  data.override ||= {}
  return data.override
}

export function getCollapsedGroups() {
  const data = getMarketDataStore()
  data.collapsedGroups ||= {}
  return data.collapsedGroups
}

// fallback 仅作为旧签名的兼容形参保留，函数体不读取；放宽到接受任意宿主 config
type BundleRecordsFallback = { market?: unknown }

export function getBundleRecords(fallback?: BundleRecordsFallback) {
  return getMarketDataStore().bundleRecords ?? {}
}

export function getWritableBundleRecords(fallback?: BundleRecordsFallback) {
  const data = getMarketDataStore()
  data.bundleRecords ||= {}
  return data.bundleRecords
}

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
