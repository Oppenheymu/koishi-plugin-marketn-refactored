/**
 * @file registry 元数据与拉取状态的 client 侧接收/清扫(app 域)。
 *
 * 模块职责:
 * - 监听三路服务端广播:market/registry(包的 registry 元数据增量合并进
 *  store.registry)、market/registry-status(各包元数据拉取状态)、
 *  market/registry-status/clear(整体清空);
 * - sweepRegistryStatus:定时清扫"卡在 loading 的拉取状态"——超过两分钟
 *  没有更新的条目按超时收敛,避免依赖卡片永远转圈。
 *
 * 消费方:getRegistryStatus/getRegistryStatusText(operations.ts)、
 * 依赖页卡片与 actions.ts 的定时清扫。
 */

import { Dict, receive, store } from '@koishijs/client'
import type { PluginBundleRecord, RegistryStatus } from 'koishi-plugin-marketn-refactored'
import type { DependencySource } from '../../src/shared/dependency-source'
import type { IgnoredUpdates } from '../shared/plugin-config'
import { translate } from '../shared/i18n'

declare module '@koishijs/client' {
  interface Config {
    market?: MarketConfig
  }
}

/** useConfig() 拿到的 market 段配置形态(市场索引拉取相关)。 */
interface MarketConfig {
  bulkMode?: boolean
  removeConfig?: boolean
  updateIgnoredPackages?: string
  updateIgnoreDuration?: number
  updateIgnoreVersions?: number
  updateIgnorePrerelease?: boolean
  gravatar?: string
  search?: {
    endpoint?: string
    timeout?: number
    autoRoute?: boolean
    logLevel?: string
  }
}

/** store 上由本插件注入的 registryStatus 通道的窄化声明(非官方 store 字段)。 */
export type MarketStore = typeof store & {
  registryStatus?: Dict<RegistryStatus>
}

/** registry 状态清扫周期(actions.ts 用它注册定时器)。 */
export const REGISTRY_STATUS_SWEEP_INTERVAL = 15_000
/** loading 状态超过此时长未更新即判超时。 */
const REGISTRY_STATUS_TIMEOUT = 120_000

/**
 * 清扫超时的拉取状态:仍在 loading 且 updatedAt 距今超过两分钟的条目
 * 改写成 timeout 终态(带可读错误文案)。返回是否有条目被改写。
 */
export function sweepRegistryStatus(target: MarketStore = store as MarketStore) {
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
  return changed
}

// registry 元数据增量广播:浅合并进 store.registry(依赖卡片据此渲染版本列表)
receive('market/registry', (data) => {
  store.registry = {
    ...store.registry,
    ...data,
  }
})

// 拉取状态广播:逐包覆盖合并,收到后顺手清扫一次超时条目
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
  sweepRegistryStatus(target)
})

// 服务端要求整体清空拉取状态(例如重新开始批量拉取)
receive('market/registry-status/clear', () => {
  const target = store as MarketStore
  target.registryStatus = {}
})
