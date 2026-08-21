import type { ComputedRef, Ref, WritableComputedRef } from 'vue'
import { message, send } from '@koishijs/client'
import type { Context } from '@koishijs/client'
import type { SearchObject } from '@koishijs/registry'
import type { PluginBundleRecord } from '../../../../../src/shared/bundle'
import { getBundleRecords, getPendingOverrides, patchMarketNextData } from '../../../../shared/config/data-store'
import { activeBundle, pendingBundleUninstalls } from '../../../../shared/ui/dialogs'
import { ensureInstalledConfig } from '../../../../shared/install/config-writer'
import type { DependencyCardProps } from './use-card'

// use-card 的操作层上下文：由 useCard 构造基础状态后传入
export interface CardActionsContext {
  props: DependencyCardProps
  ctx: Context
  t: (key: string, ...args: any[]) => string
  removeValue: string
  editing: WritableComputedRef<boolean>
  configuring: Ref<boolean>
  showBundleUninstallDialog: Ref<boolean>
  showLocalBindingDialog: Ref<boolean>
  bindingLocal: Ref<boolean>
  dep: ComputedRef<any>
  local: ComputedRef<any>
  marketData: ComputedRef<SearchObject | undefined>
  bundleRecord: ComputedRef<PluginBundleRecord | undefined>
  bundlePackage: ComputedRef<boolean>
  displayName: ComputedRef<string>
  latestVersion: ComputedRef<string | undefined>
  selectedVersion: WritableComputedRef<string>
  canExpandCard: ComputedRef<boolean>
}

export function useCardActions(input: CardActionsContext) {
  const { props, ctx, t, removeValue } = input
  const { editing, configuring, showBundleUninstallDialog, showLocalBindingDialog, bindingLocal } = input
  const { dep, local, marketData, bundleRecord, bundlePackage, displayName, latestVersion, selectedVersion, canExpandCard } = input

  function toggleCardActions() {
    if (!canExpandCard.value) return
    if (bundlePackage.value) {
      openBundlePanel()
      return
    }
    editing.value = !editing.value
  }

  function toggleEdit() {
    if (bundlePackage.value) {
      openBundlePanel()
      return
    }
    editing.value = !editing.value
  }

  function openBundlePanel() {
    const data = marketData.value
    if (data) {
      activeBundle.value = data
      return
    }
    activeBundle.value = {
      package: {
        name: props.name,
        version: dep.value?.resolved ?? local.value?.package.version ?? latestVersion.value ?? '',
        keywords: [],
      },
      shortname: displayName.value,
    } as unknown as SearchObject
  }

  function clearOverride() {
    const pendingBundle = pendingBundleUninstalls.value[props.name]
    const override = getPendingOverrides()
    delete override[props.name]
    for (const member of pendingBundle?.members ?? []) {
      delete override[member]
    }
    void patchMarketNextData({ override: { ...override } })
    delete pendingBundleUninstalls.value[props.name]
  }

  function removeDependency() {
    if (bundleRecord.value) {
      showBundleUninstallDialog.value = true
      return
    }
    selectedVersion.value = removeValue
  }

  function openLocalBinding() {
    showLocalBindingDialog.value = true
  }

  async function confirmLocalBinding() {
    if (bindingLocal.value) return
    bindingLocal.value = true
    try {
      const result = await send('market/prepare-local-binding', props.name)
      if (!result?.request) throw new Error('invalid local binding result')
      getPendingOverrides()[props.name] = result.request
      const saved = await patchMarketNextData({ override: { ...getPendingOverrides() } })
      if (!saved) {
        delete getPendingOverrides()[props.name]
        throw new Error('failed to save local binding override')
      }
      showLocalBindingDialog.value = false
      message.success(t('dependencyCard.localBinding.prepared'))
    } catch (error) {
      console.error(error)
      message.error(t('dependencyCard.localBinding.failed'))
    } finally {
      bindingLocal.value = false
    }
  }

  function findBundleOrigin(name: string): PluginBundleRecord | undefined {
    const records = getBundleRecords() as Record<string, PluginBundleRecord>
    return Object.values(records).find(record => {
      return record?.members?.some(member => member.package === name)
    })
  }

  async function configure() {
    configuring.value = true
    try {
      await ensureInstalledConfig(ctx, props.name, false)
    } finally {
      configuring.value = false
    }
  }

  return {
    toggleCardActions,
    toggleEdit,
    openBundlePanel,
    clearOverride,
    removeDependency,
    openLocalBinding,
    confirmLocalBinding,
    findBundleOrigin,
    configure,
  }
}
