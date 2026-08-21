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
let snapshotTaskKey = ''
let snapshotKey = ''
const snapshotSuperseded = new Error('market snapshot superseded')
const snapshotRetryLimit = new Error('market snapshot changed too frequently')
const MAX_SNAPSHOT_SUPERSEDED_RETRIES = 3

function getSummaryKey(value: Partial<MarketPayload> | undefined) {
  if (!value) return ''
  return [
    value.dataVersion ?? 0,
    value.debug?.hash ?? '',
  ].join(':')
}

export function publishSnapshot(value: MarketPayload): MarketSnapshot {
  const snapshot = applyRuntimeSnapshot(value) as MarketSnapshot
  const data = snapshot.data
  snapshotKey = getSummaryKey(snapshot)
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

export function restoreMarketSnapshot() {
  if (!store.market || store.market.data || !marketSnapshot.value) return
  store.market = {
    ...store.market,
    data: marketSnapshot.value.data,
  }
}

export function loadMarketSnapshot(force = false) {
  return loadMarketSnapshotAttempt(force, 0)
}

async function loadMarketSnapshotAttempt(force: boolean, supersededRetries: number): Promise<MarketSnapshot> {
  const key = getSummaryKey(store.market)
  if (!force && !marketSnapshot.value && store.market?.data) {
    return publishSnapshot(store.market)
  }
  if (!force && marketSnapshot.value && key && key === snapshotKey) {
    return marketSnapshot.value
  }
  if (snapshotTask) {
    if (!force && (!key || key === snapshotTaskKey)) return snapshotTask
    await snapshotTask.catch(() => undefined)
    return loadMarketSnapshotAttempt(force, supersededRetries)
  }

  marketSnapshotLoading.value = true
  snapshotTaskKey = key
  const task = (async () => {
    const value = await requestMarketSnapshot()
    const currentVersion = store.market?.dataVersion
    const currentKey = getSummaryKey(store.market)
    const responseKey = getSummaryKey(value)
    if (currentVersion != null && value.dataVersion != null && currentVersion > value.dataVersion) {
      throw snapshotSuperseded
    }
    if (key && currentKey && currentKey !== key && responseKey !== currentKey) {
      throw snapshotSuperseded
    }
    return publishSnapshot(value)
  })()
    .catch((error) => {
      if (error !== snapshotSuperseded) marketSnapshotError.value = error
      throw error
    })
    .finally(() => {
      if (snapshotTask === task) snapshotTask = undefined
      if (snapshotTaskKey === key) snapshotTaskKey = ''
      marketSnapshotLoading.value = false
    }) as Promise<MarketSnapshot>

  snapshotTask = task
  try {
    return await task
  } catch (error) {
    if (error === snapshotSuperseded) {
      if (supersededRetries < MAX_SNAPSHOT_SUPERSEDED_RETRIES) {
        return loadMarketSnapshotAttempt(true, supersededRetries + 1)
      }
      marketSnapshotError.value = snapshotRetryLimit
      throw snapshotRetryLimit
    }
    throw error
  }
}

export function getCurrentSnapshotData() {
  const snapshot = marketSnapshot.value
  const currentVersion = store.market?.dataVersion
  if (snapshot && (currentVersion == null || snapshot.dataVersion == null || snapshot.dataVersion === currentVersion)) {
    return snapshot.data
  }
  if (!snapshot && store.market?.data) return store.market.data
}
