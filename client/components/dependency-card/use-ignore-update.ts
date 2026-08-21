import { ref, type Ref } from 'vue'
import { message } from '@koishijs/client'
import { getMarketNextPolicy, getWritableMarketNextPolicy, patchMarketNextConfig, type MarketNextConfigPatch } from '../../lib/market-config'
import { patchMarketNextData, type MarketNextDataStore } from '../../lib/data-store'
import { createUpdateIgnoreRule } from '../../lib/update-policy'
import { useMarketNextI18n } from '../../i18n'

export function useIgnoreUpdate(props: { name: string }, showIgnoreDialog: Ref<boolean>) {
  const day = 24 * 60 * 60 * 1000
  const { t } = useMarketNextI18n()
  const ignoreDurationPreset = ref<'forever' | '1d' | '7d' | '30d' | 'custom'>('forever')
  const ignoreCustomDays = ref(7)
  const ignoreCount = ref(1)
  const ignorePackagePermanently = ref(false)
  const ignoreSaving = ref(false)

  function getUpdatePolicy() {
    return getMarketNextPolicy()
  }

  function getUpdateIgnored() {
    const policy = getWritableMarketNextPolicy()
    policy.updateIgnored ||= {}
    return policy.updateIgnored
  }

  function openIgnoreDialog() {
    const duration = Math.max(0, getUpdatePolicy().updateIgnoreDuration ?? 0)
    const days = Math.max(1, Math.ceil(duration / day))
    ignoreDurationPreset.value = duration ? getDurationPreset(duration) : 'forever'
    ignoreCustomDays.value = days
    ignoreCount.value = normalizeDialogCount(getUpdatePolicy().updateIgnoreVersions)
    ignorePackagePermanently.value = false
    showIgnoreDialog.value = true
  }

  async function confirmIgnoreUpdate() {
    if (ignoreSaving.value) return
    ignoreSaving.value = true
    if (ignorePackagePermanently.value) {
      addPackageToIgnoredList(props.name)
      delete getUpdateIgnored()[props.name]
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
    const rule = createUpdateIgnoreRule(props.name, getUpdatePolicy(), {
      duration: getDialogDuration(),
      count: ignoreCount.value,
    })
    if (!rule) {
      ignoreSaving.value = false
      return
    }
    getUpdateIgnored()[props.name] = rule
    const saved = await persistUpdatePolicy()
    ignoreSaving.value = false
    if (!saved) {
      message.error(t('common.messages.saveFailed'))
      return
    }
    showIgnoreDialog.value = false
    message.success(t('dependencyCard.ignore.saved'))
  }

  function getDurationPreset(duration: number) {
    if (duration === day) return '1d'
    if (duration === 7 * day) return '7d'
    if (duration === 30 * day) return '30d'
    return 'custom'
  }

  function getDialogDuration() {
    switch (ignoreDurationPreset.value) {
      case '1d': return day
      case '7d': return 7 * day
      case '30d': return 30 * day
      case 'custom': return normalizeDialogCount(ignoreCustomDays.value, 3650) * day
      default: return 0
    }
  }

  function normalizeDialogCount(value?: number, max = 20) {
    if (!Number.isFinite(value)) return 1
    return Math.max(1, Math.min(max, Math.floor(value!)))
  }

  function addPackageToIgnoredList(name: string) {
    const policy = getWritableMarketNextPolicy()
    const names = (policy.updateIgnoredPackages ?? '')
      .split(/[\s,，;；]+/g)
      .map(item => item.trim())
      .filter(Boolean)
    if (!names.some(item => item.toLowerCase() === name.toLowerCase())) {
      names.push(name)
    }
    policy.updateIgnoredPackages = names.join('\n')
  }

  async function restoreUpdate() {
    delete getUpdateIgnored()[props.name]
    removePackageFromIgnoredList(props.name)
    const saved = await persistUpdatePolicy()
    if (!saved) message.error(t('common.messages.saveFailed'))
  }

  async function persistUpdatePolicy() {
    const policy = getUpdatePolicy()
    const configSaved = await patchMarketNextConfig({
      updateIgnoredPackages: policy.updateIgnoredPackages,
      updateIgnoreDuration: policy.updateIgnoreDuration,
      updateIgnoreVersions: policy.updateIgnoreVersions,
      updateIgnorePrerelease: policy.updateIgnorePrerelease,
    } as Partial<MarketNextConfigPatch>)
    const dataSaved = await patchMarketNextData({
      updateIgnored: policy.updateIgnored,
    } as Partial<MarketNextDataStore>)
    return configSaved && dataSaved
  }

  function removePackageFromIgnoredList(name: string) {
    const policy = getWritableMarketNextPolicy()
    const names = (policy.updateIgnoredPackages ?? '')
      .split(/[\s,，;；]+/g)
      .map(item => item.trim())
      .filter(Boolean)
      .filter(item => item.toLowerCase() !== name.toLowerCase())
    policy.updateIgnoredPackages = names.join('\n')
  }

  return {
    ignoreDurationPreset,
    ignoreCustomDays,
    ignoreCount,
    ignorePackagePermanently,
    ignoreSaving,
    openIgnoreDialog,
    confirmIgnoreUpdate,
    restoreUpdate,
  }
}
