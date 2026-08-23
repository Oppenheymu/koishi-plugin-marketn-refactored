/**
 * @file "忽略此更新"对话框与忽略策略持久化 composable(dependencies 域)。
 *
 * 对话框支持永久禁检(包名进 updateIgnoredPackages)与按时长/次数忽略
 * (规则进数据仓 updateIgnored);确认后双写插件配置与数据仓,恢复更新
 * 则同时清规则与禁检名单。
 */

import { ref } from 'vue'
import { message } from '@koishijs/client'
import { createUpdateIgnoreRule, getWritableMarketNextPolicy, patchMarketNextConfig, patchMarketNextData } from '../../shared/plugin-config'
import {
  day,
  dialogDuration,
  getDurationPreset,
  normalizeDialogCount,
  type IgnoreDurationPreset,
} from './package-utils'
import type { PackageCardState } from './use-package-card-state'

export function useIgnoreUpdate(
  state: PackageCardState,
  config: { value: unknown },
  t: (key: string, ...args: any[]) => string,
) {
  const showIgnoreDialog = ref(false)
  const ignoreDurationPreset = ref<IgnoreDurationPreset>('forever')
  const ignoreCustomDays = ref(7)
  const ignoreCount = ref(1)
  const ignorePackagePermanently = ref(false)
  const ignoreSaving = ref(false)

  function openIgnoreDialog() {
    const duration = Math.max(0, state.getUpdatePolicy().updateIgnoreDuration ?? 0)
    const days = Math.max(1, Math.ceil(duration / day))
    ignoreDurationPreset.value = duration ? getDurationPreset(duration) : 'forever'
    ignoreCustomDays.value = days
    ignoreCount.value = normalizeDialogCount(state.getUpdatePolicy().updateIgnoreVersions)
    ignorePackagePermanently.value = false
    showIgnoreDialog.value = true
  }

  async function confirmIgnoreUpdate() {
    if (ignoreSaving.value) return
    ignoreSaving.value = true
    if (ignorePackagePermanently.value) {
      addPackageToIgnoredList(state.name)
      delete state.getUpdateIgnored()[state.name]
      const saved = await persistUpdatePolicy()
      ignoreSaving.value = false
      if (!saved) {
        message.error(t('common.messages.saveFailed'))
        return
      }
      showIgnoreDialog.value = false
      message.success(t('dependencyCard.ignore.addedToDisabled'))
      return
    }
    const rule = createUpdateIgnoreRule(state.name, state.getUpdatePolicy(), {
      duration: dialogDuration(ignoreDurationPreset.value, ignoreCustomDays.value),
      count: ignoreCount.value,
    })
    if (!rule) {
      ignoreSaving.value = false
      return
    }
    state.getUpdateIgnored()[state.name] = rule
    const saved = await persistUpdatePolicy()
    ignoreSaving.value = false
    if (!saved) {
      message.error(t('common.messages.saveFailed'))
      return
    }
    showIgnoreDialog.value = false
    message.success(t('dependencyCard.ignore.saved'))
  }

  async function restoreUpdate() {
    delete state.getUpdateIgnored()[state.name]
    removePackageFromIgnoredList(state.name)
    const saved = await persistUpdatePolicy()
    if (!saved) message.error(t('common.messages.saveFailed'))
  }

  /** 忽略策略双写:全局开关进插件配置,逐包规则进数据仓。 */
  async function persistUpdatePolicy() {
    const policy = state.getUpdatePolicy()
    const configSaved = await patchMarketNextConfig({
      updateIgnoredPackages: policy.updateIgnoredPackages,
      updateIgnoreDuration: policy.updateIgnoreDuration,
      updateIgnoreVersions: policy.updateIgnoreVersions,
      updateIgnorePrerelease: policy.updateIgnorePrerelease,
    })
    const dataSaved = await patchMarketNextData({
      updateIgnored: policy.updateIgnored,
    })
    return configSaved && dataSaved
  }

  function addPackageToIgnoredList(name: string) {
    const policy = getWritableMarketNextPolicy(config.value as any)
    const names = splitIgnoredPackages(policy.updateIgnoredPackages)
    if (!names.some(item => item.toLowerCase() === name.toLowerCase())) {
      names.push(name)
    }
    policy.updateIgnoredPackages = names.join('\n')
  }

  function removePackageFromIgnoredList(name: string) {
    const policy = getWritableMarketNextPolicy(config.value as any)
    const names = splitIgnoredPackages(policy.updateIgnoredPackages)
      .filter(item => item.toLowerCase() !== name.toLowerCase())
    policy.updateIgnoredPackages = names.join('\n')
  }

  function splitIgnoredPackages(value?: string) {
    return (value ?? '')
      .split(/[\s,，;；]+/g)
      .map(item => item.trim())
      .filter(Boolean)
  }

  return {
    showIgnoreDialog, ignoreDurationPreset, ignoreCustomDays, ignoreCount,
    ignorePackagePermanently, ignoreSaving, openIgnoreDialog, confirmIgnoreUpdate, restoreUpdate,
  }
}
