import { receive, send, store } from '@koishijs/client'
import { markRaw, shallowRef } from 'vue'
import { collectServiceProviders } from '../../../src/shared/lookup'
import type { MarketLookupRequest, MarketLookupResult, MarketPayload } from '../../../src/shared/types'
import { getCurrentSnapshotData, marketSnapshot, publishSnapshot, type MarketSnapshot } from './snapshot'

const marketLookupData = shallowRef<MarketSnapshot['data']>({})
const marketLookupServices = shallowRef<Record<string, string[]>>({})

let lookupDataVersion: number | undefined
let lookupGeneration = 0
const lookupTasks = new Map<string, Promise<void>>()
const missingMarketObjects = new Set<string>()
const requestedMarketObjects = new Set<string>()
const requestedMarketServices = new Set<string>()

export function getMarketObject(name: string) {
  return marketLookupData.value[name] ?? getCurrentSnapshotData()?.[name]
}

export function getMarketServiceProviders(name: string) {
  return marketLookupServices.value[name] ?? []
}

export function loadMarketObjects(names: Iterable<string>) {
  const normalized = normalizeLookupValues(names)
  for (const name of normalized) requestedMarketObjects.add(name)
  return loadMarketLookup({ names: normalized })
}

export function loadMarketServiceProviders(names: Iterable<string>) {
  const normalized = normalizeLookupValues(names)
  for (const name of normalized) requestedMarketServices.add(name)
  return loadMarketLookup({ services: normalized })
}

export async function refreshMarketLookups() {
  lookupGeneration++
  lookupTasks.clear()
  lookupDataVersion = undefined
  missingMarketObjects.clear()
  marketLookupData.value = {}
  marketLookupServices.value = {}
  const names = Array.from(requestedMarketObjects)
  const services = Array.from(requestedMarketServices)
  if (!names.length && !services.length) return
  await loadMarketLookup({ names, services }, true)
}

function normalizeLookupValues(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values)
    .filter(value => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean)))
}

async function loadMarketLookup(request: MarketLookupRequest, force = false) {
  const names = normalizeLookupValues(request.names ?? [])
  const services = normalizeLookupValues(request.services ?? [])
  if (!names.length && !services.length) return

  const fullData = getCurrentSnapshotData()
  if (fullData && !force) {
    for (const name of names) {
      if (!fullData[name]) missingMarketObjects.add(name)
    }
    if (services.length) {
      marketLookupServices.value = {
        ...marketLookupServices.value,
        ...collectServiceProviders(fullData, services),
      }
    }
    return
  }

  const currentVersion = store.market?.dataVersion
  const lookupCurrent = currentVersion == null || lookupDataVersion == null || lookupDataVersion === currentVersion
  const pendingNames = force ? names : names.filter(name => {
    if (fullData?.[name]) return false
    if (lookupCurrent && (marketLookupData.value[name] || missingMarketObjects.has(name))) return false
    return true
  })
  const pendingServices = force ? services : services.filter(name => {
    return !Object.prototype.hasOwnProperty.call(marketLookupServices.value, name)
  })
  if (!pendingNames.length && !pendingServices.length) return

  const key = JSON.stringify([pendingNames.slice().sort(), pendingServices.slice().sort(), force])
  if (lookupTasks.has(key)) return lookupTasks.get(key)
  const generation = lookupGeneration
  let superseded = false
  const task = (async () => {
    const response = await send('market/lookup', {
      names: pendingNames,
      services: pendingServices,
    }) as MarketLookupResult | undefined
    if (!response || generation !== lookupGeneration) return
    const latestVersion = store.market?.dataVersion
    if (latestVersion != null && response.dataVersion != null && latestVersion > response.dataVersion) {
      superseded = true
      return
    }
    lookupDataVersion = response.dataVersion
    for (const name of pendingNames) {
      if (!response.data[name]) missingMarketObjects.add(name)
    }
    marketLookupData.value = markRaw({
      ...marketLookupData.value,
      ...response.data,
    })
    marketLookupServices.value = {
      ...marketLookupServices.value,
      ...response.services,
    }
  })().finally(() => {
    if (lookupTasks.get(key) === task) lookupTasks.delete(key)
  })
  lookupTasks.set(key, task)
  await task
  if (superseded) return loadMarketLookup({ names: pendingNames, services: pendingServices }, true)
}

receive('market/patch', (value: Partial<MarketPayload>) => {
  if (!marketSnapshot.value || !value.data) return
  publishSnapshot({
    ...marketSnapshot.value,
    ...value,
    data: {
      ...marketSnapshot.value.data,
      ...value.data,
    },
  })
})
