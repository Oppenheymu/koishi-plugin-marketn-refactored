import { computed, inject, ref, watch } from 'vue'
import type { ComputedRef } from 'vue'
import { global, message, store, useContext } from '@koishijs/client'
import type {} from '@koishijs/plugin-config'
import type { PluginBundleRecord } from '../../../src/shared/bundle'
import { getPendingOverrides, getBundleRecords, getWritableBundleRecords, patchMarketNextData } from '../../shared/config/data-store'
import { getBulkMode, getRemoveConfig, getMarketNextPolicy } from '../../shared/config/market-config'
import { hasUpdate } from '../../shared/config/update-policy'
import { createLocalBundleRecord, fetchBundleRecord } from '../../shared/install/bundle-records'
import type { BundleRecordView } from '../../shared/install/bundle-records'
import { getConfigWriter } from '../../shared/install/config-writer'
import { install } from '../../shared/install/install-flow'
import { pendingBundleUninstalls } from '../../shared/ui/dialogs'
import { useMarketNextI18n } from '../../i18n'
import { getMarketObject, loadMarketObjects } from '../../market/state'

export function useVersion() {
  const ctx = useContext()
  const { t } = useMarketNextI18n()
  const name = inject<ComputedRef<string>>('plugin:name')
  const protectedDeps = new Set(['@koishijs/plugin-console', '@koishijs/plugin-config', '@koishijs/plugin-server'])

  const local = computed(() => store.packages?.[name.value])
  const object = computed(() => getMarketObject(name.value))
  const dep = computed(() => store.dependencies?.[name.value])
  const versions = computed(() => store.registry?.[name.value])
  const updateAvailable = computed(() => hasUpdate(name.value, getMarketNextPolicy()))
  const uninstalling = ref(false)
  const loadingBundleRecord = ref(false)
  const showUninstallDialog = ref(false)
  const showBundleUninstallDialog = ref(false)
  const remoteBundleRecord = ref<BundleRecordView>()

  watch(name, (value) => {
    if (!value) return
    void loadMarketObjects([value]).catch(error => {
      console.error('[market-next] failed to load plugin market metadata', error)
    })
  }, { immediate: true })

  const pendingRemove = computed(() => {
    const override = getPendingOverrides()
    return Object.prototype.hasOwnProperty.call(override, name.value) && !override[name.value]
  })

  const hasConfigEntries = computed(() => {
    return !!getConfigWriter(ctx)?.get(name.value)?.length
  })

  const bundleRecord = computed<BundleRecordView | PluginBundleRecord | undefined>(() => {
    const stored = getBundleRecords()[name.value]
    if (stored) return stored
    if (remoteBundleRecord.value?.package === name.value) return remoteBundleRecord.value
    return createLocalBundleRecord(name.value)
  })

  const showDependencyUninstall = computed(() => {
    if (global.static || protectedDeps.has(name.value)) return false
    if (local.value?.workspace || dep.value?.workspace) return false
    if (pendingRemove.value) return true
    if (store.dependencies) return !!dep.value
    return !!local.value
  })

  function ensureOverride() {
    return getPendingOverrides()
  }

  async function requestUninstall() {
    if (!name.value || uninstalling.value) return
    if (bundleRecord.value) {
      await loadRemoteBundleRecord()
      showBundleUninstallDialog.value = true
      return
    }
    if (getBulkMode()) {
      const override = ensureOverride()
      override[name.value] = ''
      void patchMarketNextData({ override: { ...override } })
      message.success(t('extensions.messages.stagedUninstall'))
      return
    }
    const savedRemoveConfig = getRemoveConfig()
    if (hasConfigEntries.value && typeof savedRemoveConfig !== 'boolean') {
      showUninstallDialog.value = true
      return
    }
    return uninstallDependency(savedRemoveConfig === true)
  }

  async function loadRemoteBundleRecord() {
    if (!name.value || getBundleRecords()[name.value]) return
    if (remoteBundleRecord.value?.package === name.value && remoteBundleRecord.value.members.length) return
    loadingBundleRecord.value = true
    try {
      const record = await fetchBundleRecord(name.value)
      if (record) remoteBundleRecord.value = record
    } catch (error) {
      console.warn(error)
      message.warning(t('extensions.messages.bundleRecordFailedShort'))
    } finally {
      loadingBundleRecord.value = false
    }
  }

  function cancelPendingUninstall() {
    const pendingBundle = pendingBundleUninstalls.value[name.value]
    const override = ensureOverride()
    delete override[name.value]
    for (const member of pendingBundle?.members ?? []) {
      delete override[member]
    }
    void patchMarketNextData({ override: { ...override } })
    delete pendingBundleUninstalls.value[name.value]
    message.success(t('extensions.messages.cancelUninstall'))
  }

  async function uninstallDependency(removeConfig: boolean) {
    if (!name.value || uninstalling.value) return
    showUninstallDialog.value = false
    uninstalling.value = true
    try {
      await install({ [name.value]: '' }, async () => {
        if (removeConfig) getConfigWriter(ctx)?.remove(name.value)
        const records = getWritableBundleRecords()
        delete records[name.value]
        const saved = await patchMarketNextData({ bundleRecords: records })
        if (!saved) message.warning(t('extensions.messages.bundleRecordFailed'))
      }, undefined, {
        loadingText: t('operations.install.uninstalling'),
        successText: t('operations.install.uninstalled'),
        errorText: t('operations.install.uninstallFailed'),
        timeoutText: t('operations.install.uninstallTimeout'),
      })
    } finally {
      uninstalling.value = false
    }
  }

  return {
    name,
    local,
    object,
    dep,
    versions,
    updateAvailable,
    uninstalling,
    loadingBundleRecord,
    showUninstallDialog,
    showBundleUninstallDialog,
    pendingRemove,
    bundleRecord,
    showDependencyUninstall,
    requestUninstall,
    cancelPendingUninstall,
    uninstallDependency,
  }
}
