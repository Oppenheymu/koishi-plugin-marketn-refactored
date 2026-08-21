import type { ComputedRef, Ref, WritableComputedRef } from 'vue'
import type { Context } from '@koishijs/client'
import type { SearchObject } from '@koishijs/registry'
import type { RegistryStatus } from 'koishi-plugin-marketn-refactored'
import type { PluginBundleRecord } from '../../../../../src/shared/bundle'
import type { DependencyCardProps, ItemKind } from './use-card'

// use-card 的展示层上下文：基础状态 refs 由 useCard 构造后传入，
// dep/local/data 等宿主 store 派生值在展示逻辑中本就按宽松形状访问
export interface CardViewContext {
  props: DependencyCardProps
  ctx: Context
  t: (key: string, ...args: any[]) => string
  locale: Ref<string>
  dep: ComputedRef<any>
  local: ComputedRef<any>
  localDependency: ComputedRef<boolean>
  marketData: ComputedRef<SearchObject | undefined>
  bundleRecord: ComputedRef<PluginBundleRecord | undefined>
  bundleOrigin: ComputedRef<PluginBundleRecord | undefined>
  displayName: ComputedRef<string>
  data: ComputedRef<any>
  status: ComputedRef<RegistryStatus | undefined>
  latestVersion: ComputedRef<string | undefined>
  overrideValue: ComputedRef<string | undefined>
  pending: ComputedRef<boolean>
  pendingRemove: ComputedRef<boolean>
  updateCheckDisabled: ComputedRef<boolean>
  ignoredUpdate: ComputedRef<boolean>
  updatable: ComputedRef<boolean>
  bundlePackage: ComputedRef<boolean>
  unconfigured: ComputedRef<boolean>
  statusClass: ComputedRef<ItemKind>
  canExpandCard: ComputedRef<boolean>
  selectedVersion: WritableComputedRef<string>
  editing: WritableComputedRef<boolean>
}
