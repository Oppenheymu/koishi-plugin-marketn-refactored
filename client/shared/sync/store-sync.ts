import { isReactive, markRaw, toRaw, watch } from 'vue'
import { type Context, type Dict, receive, store } from '@koishijs/client'
import type { RegistryStatus } from 'koishi-plugin-marketn-refactored'
import { translate } from '../../i18n'
import { getPendingOverrides, patchMarketNextData } from '../config/data-store'
import { loadMarketSnapshot, refreshMarketLookups } from '../../market/state'
import { marketRuntimeStore } from '../../market/runtime-store'

const REGISTRY_STATUS_TIMEOUT = 120000
const REGISTRY_STATUS_SWEEP_INTERVAL = 15000

type MarketStore = typeof store & {
  registryStatus?: Dict<RegistryStatus>
}

function sweepRegistryStatus(target: MarketStore = store as MarketStore) {
  const now = Date.now()
  const next = { ...target.registryStatus }
  let changed = false
  for (const [name, status] of Object.entries(next)) {
    if (!status?.loading) continue
    if (status.updatedAt && now - status.updatedAt <= REGISTRY_STATUS_TIMEOUT) continue
    next[name] = {
      ...status,
      loading: false,
      reason: 'timeout',
      error: translate('common.messages.metadataTimeout'),
    }
    changed = true
  }
  if (changed) target.registryStatus = next
  if (changed && target === store) marketRuntimeStore.registryStatus.value = next
  return changed
}

receive('market/registry', (data) => {
  store.registry = {
    ...store.registry,
    ...data,
  }
})

receive('market/registry-status', (data: Dict<RegistryStatus>) => {
  const target = store as MarketStore
  const next = { ...target.registryStatus }
  for (const [name, status] of Object.entries(data)) {
    if (!status) continue
    next[name] = status
  }
  target.registryStatus = {
    ...next,
  }
  marketRuntimeStore.registryStatus.value = target.registryStatus
  sweepRegistryStatus(target)
})

receive('market/registry-status/clear', () => {
  const target = store as MarketStore
  target.registryStatus = {}
  marketRuntimeStore.registryStatus.value = {}
})

export function setupStoreSync(ctx: Context) {
  // Market indexes contain thousands of nested objects. Keep the index raw so
  // opening market-next does not turn the entire Console store into deep Vue proxies.
  ctx.effect(() => watch(() => store.market?.data, (data) => {
    if (!data || !isReactive(data)) return
    const raw = markRaw(toRaw(data))
    if (store.market) store.market.data = raw
  }, { immediate: true, flush: 'sync' }))

  ctx.effect(() => watch(() => store.market?.dataVersion, (version, previous) => {
    if (version == null || previous == null || version === previous) return
    void loadMarketSnapshot(true).catch(error => {
      console.error('[market-next] failed to refresh market snapshot', error)
    })
    void refreshMarketLookups().catch(error => {
      console.error('[market-next] failed to refresh market lookups', error)
    })
  }))

  ctx.effect(() => {
    const timer = window.setInterval(() => sweepRegistryStatus(), REGISTRY_STATUS_SWEEP_INTERVAL)
    return () => window.clearInterval(timer)
  })

  ctx.effect(() => {
    return watch(() => store.dependencies, (value) => {
      if (!value) return
      const overrides = getPendingOverrides()
      for (const key in overrides) {
        if (!overrides[key] && !value[key]) {
          // package to be removed has been removed
          delete overrides[key]
        } else if (value[key]?.request === overrides[key]) {
          // package has been installed to the right version
          delete overrides[key]
        }
      }
      void patchMarketNextData({ override: { ...overrides } })
    }, { immediate: true })
  })
}
