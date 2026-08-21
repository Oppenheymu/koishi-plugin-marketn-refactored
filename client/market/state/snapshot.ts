import { store } from '@koishijs/client'
import type {
  MarketPayload,
  MarketSnapshotResponse,
  MarketSnapshotTransfer,
} from '../../../src/shared/types'
import { requestMarketIndex } from '../api'
import { applyRuntimeSnapshot, marketRuntimeStore } from '../runtime-store'

export type MarketSnapshot = MarketPayload & {
  data: NonNullable<MarketPayload['data']>
}

export const marketSnapshot = marketRuntimeStore.snapshot
export const marketSnapshotLoading = marketRuntimeStore.loading
export const marketSnapshotError = marketRuntimeStore.error

let snapshotTask: Promise<MarketSnapshot> | undefined

export function publishSnapshot(value: MarketPayload): MarketSnapshot {
  const snapshot = applyRuntimeSnapshot(value) as MarketSnapshot
  const data = snapshot.data
  marketSnapshotError.value = undefined

  // Keep legacy consumers working without making the nested index reactive.
  store.market = {
    ...(store.market ?? {}),
    ...snapshot,
    data,
  }
  return snapshot
}

function isMarketSnapshotTransfer(value: MarketSnapshotResponse): value is MarketSnapshotTransfer {
  return !!value && 'transport' in value && value.transport === 'http-gzip'
}

async function resolveMarketSnapshot(value: MarketSnapshotResponse): Promise<MarketPayload> {
  if (!isMarketSnapshotTransfer(value)) return value
  const response = await fetch(value.url, {
    cache: 'force-cache',
    credentials: 'same-origin',
  })
  if (!response.ok) throw new Error(`market snapshot request failed with ${response.status}`)
  const data = await response.json()
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('market snapshot response is invalid')
  }
  return {
    ...value.payload,
    data,
  }
}

async function requestMarketSnapshot() {
  const response = await requestMarketIndex({ transport: 'http-gzip' })
  if (!response) throw new Error('market index request is unavailable')
  try {
    return await resolveMarketSnapshot(response)
  } catch (error) {
    if (!isMarketSnapshotTransfer(response)) throw error
    console.warn('[market-next] compressed market snapshot failed, falling back to console transport', error)
    const fallback = await requestMarketIndex({ transport: 'inline' })
    if (!fallback) throw new Error('market index fallback request is unavailable')
    return resolveMarketSnapshot(fallback)
  }
}

export function getMarketSnapshotData() {
  return marketSnapshot.value?.data ?? store.market?.data ?? {}
}

export function loadMarketSnapshot(force = false) {
  if (!force && !marketSnapshot.value && store.market?.data) {
    return Promise.resolve(publishSnapshot(store.market))
  }
  if (!force && marketSnapshot.value) return Promise.resolve(marketSnapshot.value)
  if (snapshotTask) return snapshotTask

  marketSnapshotLoading.value = true
  const task = requestMarketSnapshot()
    .then(publishSnapshot)
    .catch((error) => {
      marketSnapshotError.value = error
      throw error
    })
    .finally(() => {
      if (snapshotTask === task) snapshotTask = undefined
      marketSnapshotLoading.value = false
    }) as Promise<MarketSnapshot>
  snapshotTask = task
  return task
}

export function getCurrentSnapshotData() {
  return marketSnapshot.value?.data ?? store.market?.data
}
