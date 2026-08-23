/**
 * @file 市场快照与按需查找（lookup）的 client 侧状态层（market 域）。
 *
 * 模块职责:
 * - 维护全量市场快照 marketSnapshot(shallowRef + markRaw:数据量大,避免深响应式开销),
 *  并同步写入 legacy 的 store.market 供旧组件消费;
 * - loadMarketObjects / loadMarketServiceProviders:按包名/服务名做增量 lookup,
 *  服务端只回传请求的那几条,避免整份快照下发;
 * - refreshMarketLookups:快照版本更新后重放全部历史 lookup 请求。
 *
 * 关键设计:
 * - 传输协商:优先 http-gzip(快照走 HTTP 大对象,经浏览器缓存),失败回退 console 内联;
 * - 竞态防护:快照用 dataVersion+hash 组成的 summaryKey 判"是否已被更新的数据
 *  取代"(snapshotSuperseded),lookup 用递增的 lookupGeneration 丢弃过期响应,
 *  superseded 快照最多重试 3 次,超过抛 snapshotRetryLimit 防抖动风暴;
 * - 同质请求用 pendingNames/pendingServices 排序后 JSON 序列化成 key 做单飞去重。
 */

import { receive, send, store } from '@koishijs/client'
import { markRaw, ref, shallowRef } from 'vue'
import type {
  MarketLookupRequest,
  MarketLookupResult,
  MarketProvider,
  MarketSnapshotResponse,
  MarketSnapshotTransfer,
} from '../../src/shared'

/** 快照的有效形态:服务端保证 data 非空(inline 或已解压完成)。 */
type MarketSnapshot = MarketProvider.Payload & {
  data: NonNullable<MarketProvider.Payload['data']>
}

/** 全量市场快照;undefined 表示尚未加载成功。 */
export const marketSnapshot = shallowRef<MarketSnapshot>()
/** 快照加载中标记(驱动页面 loading 态)。 */
export const marketSnapshotLoading = ref(false)
/** 快照加载失败原因(未失败为 undefined)。 */
export const marketSnapshotError = ref<unknown>()
/** lookup 结果缓存:包名 → 市场对象(仅含按需请求过的条目)。 */
const marketLookupData = shallowRef<MarketSnapshot['data']>({})
/** lookup 结果缓存:服务名 → 实现该服务的包名列表。 */
const marketLookupServices = shallowRef<Record<string, string[]>>({})

/** 进行中的快照请求(单飞:并发调用复用同一 Promise)。 */
let snapshotTask: Promise<MarketSnapshot> | undefined
/** 发起快照请求时观察到的 store 摘要 key,用于事后判定是否被新数据取代。 */
let snapshotTaskKey = ''
/** 最近一次成功发布快照的摘要 key。 */
let snapshotKey = ''
/** lookup 数据对应的快照 dataVersion(快照换版后需作废重放)。 */
let lookupDataVersion: number | undefined
/** lookup 世代号:每次 refreshMarketLookups 自增,旧世代的响应直接丢弃。 */
let lookupGeneration = 0
/** 进行中的 lookup 任务,按请求 key 去重。 */
const lookupTasks = new Map<string, Promise<void>>()
/** 确认在当前快照中不存在的包名(避免反复请求同一个 404 条目)。 */
const missingMarketObjects = new Set<string>()
/** 历史上请求过的包名(refreshMarketLookups 重放的依据)。 */
const requestedMarketObjects = new Set<string>()
/** 历史上请求过的服务名。 */
const requestedMarketServices = new Set<string>()
/** 哨兵错误:请求期间 store 已被服务端推送的更新数据覆盖。 */
const snapshotSuperseded = new Error('market snapshot superseded')
/** 哨兵错误:superseded 重试超过上限,快照变化过于频繁。 */
const snapshotRetryLimit = new Error('market snapshot changed too frequently')
const MAX_SNAPSHOT_SUPERSEDED_RETRIES = 3

/** 计算快照摘要 key:dataVersion + debug hash,用于快速判断两份数据是否一致。 */
function getSummaryKey(value: Partial<MarketProvider.Payload> | undefined) {
  if (!value) return ''
  return [
    value.dataVersion ?? 0,
    value.debug?.hash ?? '',
  ].join(':')
}

/**
 * 发布快照:写入 shallowRef、清空错误态,并同步到 legacy 的 store.market。
 * data 经 markRaw 处理——快照条目数万级,禁止被 Vue 深度代理。
 */
function publishSnapshot(value: MarketProvider.Payload): MarketSnapshot {
  const data = markRaw(value.data ?? {})
  const snapshot = markRaw({ ...value, data }) as MarketSnapshot
  marketSnapshot.value = snapshot
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

/** 类型守卫:响应是否为"HTTP 传输"形态(数据本体在 url 指向的 gzip 资源里)。 */
function isMarketSnapshotTransfer(value: MarketSnapshotResponse): value is MarketSnapshotTransfer {
  return !!value && 'transport' in value && value.transport === 'http-gzip'
}

/** 把传输形态的响应补全为完整快照载荷:fetch url 拿数据本体并合并回 payload。 */
async function resolveMarketSnapshot(value: MarketSnapshotResponse): Promise<MarketProvider.Payload> {
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

/**
 * 请求市场快照:先尝试 http-gzip 传输(大数据走 HTTP + 浏览器缓存),
 * 失败则告警并回退 console 内联传输。
 */
async function requestMarketSnapshot() {
  const response = await (send('market/index' as any, {
    transport: 'http-gzip',
  }) as Promise<MarketSnapshotResponse> | undefined)
  if (!response) throw new Error('market index request is unavailable')
  try {
    return await resolveMarketSnapshot(response)
  } catch (error) {
    if (!isMarketSnapshotTransfer(response)) throw error
    console.warn('[market-next] compressed market snapshot failed, falling back to console transport', error)
    const fallback = await (send('market/index' as any, {
      transport: 'inline',
    }) as Promise<MarketSnapshotResponse> | undefined)
    if (!fallback) throw new Error('market index fallback request is unavailable')
    return resolveMarketSnapshot(fallback)
  }
}

/** 当前可用的快照数据:优先 shallowRef,其次 legacy store。 */
export function getMarketSnapshotData() {
  return marketSnapshot.value?.data ?? store.market?.data ?? {}
}

/** 取单个市场对象:先查 lookup 缓存,再查当前快照全量数据。 */
export function getMarketObject(name: string) {
  return marketLookupData.value[name] ?? getCurrentSnapshotData()?.[name]
}

/** 取实现某服务的包名列表(未查询过返回空数组)。 */
export function getMarketServiceProviders(name: string) {
  return marketLookupServices.value[name] ?? []
}

/**
 * 把快照数据回填到 legacy store.market:服务端推送可能只带部分字段把
 * store.market.data 冲掉,此函数在检测到丢失时用 shallowRef 里的完整数据补回。
 */
export function restoreMarketSnapshot() {
  if (!store.market || store.market.data || !marketSnapshot.value) return
  store.market = {
    ...store.market,
    data: marketSnapshot.value.data,
  }
}

/** 加载市场快照(带 superseded 重试);force=true 时无视缓存强制刷新。 */
export function loadMarketSnapshot(force = false) {
  return loadMarketSnapshotAttempt(force, 0)
}

/**
 * 快照加载的带重试实现。缓存判定顺序:
 * 1. 无本地快照但 store.market 有数据 → 直接采用(服务端推送的初值);
 * 2. 已有快照且 store 摘要 key 未变 → 返回缓存;
 * 3. 有进行中任务且 key 匹配(或 store 尚无 key)→ 复用该任务;
 * 4. 否则发起新请求,响应回来后再次比对 store 的版本:
 *    本地 dataVersion 已比响应新,或 store 摘要已变成另一个更新的值,
 *    则判定 superseded,抛哨兵错误由外层重试(最多 3 次)。
 */
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
    // store 已指向更新的数据:等旧任务落地后带着新 key 重进
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

/** 按包名做增量 lookup(去重/去空白后登记,供快照刷新时重放)。 */
export function loadMarketObjects(names: Iterable<string>) {
  const normalized = normalizeLookupValues(names)
  for (const name of normalized) requestedMarketObjects.add(name)
  return loadMarketLookup({ names: normalized })
}

/** 按服务名做增量 lookup:返回实现该服务的包名列表。 */
export function loadMarketServiceProviders(names: Iterable<string>) {
  const normalized = normalizeLookupValues(names)
  for (const name of normalized) requestedMarketServices.add(name)
  return loadMarketLookup({ services: normalized })
}

/**
 * 快照版本更新后的 lookup 全量重放:世代号 +1 使旧响应作废,清空全部
 * lookup 缓存与去重集合,再把历史请求过的包名/服务名一次性重新拉取。
 */
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

/**
 * 当前快照数据的有效性判定:shallowRef 快照与 store 的 dataVersion 一致
 * (或任一侧缺版本号)时可用;否则只认 store 自己带的数据。
 */
function getCurrentSnapshotData() {
  const snapshot = marketSnapshot.value
  const currentVersion = store.market?.dataVersion
  if (snapshot && (currentVersion == null || snapshot.dataVersion == null || snapshot.dataVersion === currentVersion)) {
    return snapshot.data
  }
  if (!snapshot && store.market?.data) return store.market.data
}

/** lookup 入参归一化:转数组、剔除非字符串、trim、去重、去空。 */
function normalizeLookupValues(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values)
    .filter(value => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean)))
}

/** 在快照全量数据里扫出各服务的实现者包名,结果按包名排序保证展示稳定。 */
function collectServiceProviders(data: MarketSnapshot['data'], services: string[]) {
  const result = Object.fromEntries(services.map(name => [name, [] as string[]]))
  const requested = new Set(services)
  for (const object of Object.values(data)) {
    const implemented = object?.manifest?.service?.implements
    if (!Array.isArray(implemented)) continue
    for (const service of implemented) {
      if (requested.has(service)) result[service].push(object.package.name)
    }
  }
  for (const service of services) result[service].sort()
  return result
}

/**
 * lookup 的核心实现。流程:
 * 1. 当前快照数据可用且非强制 → 直接本地满足(包名记入 missing 集合,
 *    服务名本地扫描),不发请求;
 * 2. 否则筛选出仍缺失的 pendingNames/pendingServices(已缓存、已确认
 *    missing、或快照没换版的直接跳过),全空则返回;
 * 3. 以排序后的请求 key 查 lookupTasks 做单飞去重,命中则复用;
 * 4. 发 market/lookup RPC,响应回来先验世代号与 dataVersion,过期
 *    (superseded)则带着 force 重进一次。
 */
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

// 服务端增量补丁:只带变化条目时,与现有快照浅合并后重新发布
receive('market/patch', (value: Partial<MarketProvider.Payload>) => {
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
