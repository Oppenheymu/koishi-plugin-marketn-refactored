import { computed, ref } from 'vue'
import { message, store, useContext, useConfig } from '@koishijs/client'
import { parse } from 'semver'
import { analyzeVersions, type PeerInfo, type ResultType } from '../../shared/install/analyze-versions'
import { createLocalBundleRecord } from '../../shared/install/bundle-records'
import { ensureInstalledConfig, getConfigWriter } from '../../shared/install/config-writer'
import { active } from '../../shared/ui/dialogs'
import { getBundleRecords, getPendingOverrides, getWritableBundleRecords, patchMarketNextData } from '../../shared/config/data-store'
import { install } from '../../shared/install/install-flow'
import { getBulkMode, getRemoveConfig, patchMarketNextConfig } from '../../shared/config/market-config'
import { useMarketModeClass } from '../../shared/ui/market-mode'
import { getRegistryStatus, getRegistryStatusText } from '../../shared/install/registry-status'
import { isBundlePackageName } from '../../../src/shared/bundle'
import { useMarketNextI18n } from '../../i18n'
import { getMarketObject } from '../../market/state'
import { useInstallVersions } from './use-install-versions'
import { useInstallRegistrySync } from './use-install-registry'

export function useInstall() {
  const ctx = useContext()
  const config = useConfig()
  const { t } = useMarketNextI18n()
  const { modeClass, versionPopperClass } = useMarketModeClass()

  const saveChoice = ref(false)
  const showRemoveDialog = ref(false)
  const showBundleUninstallDialog = ref(false)
  const bundleUninstallTarget = ref('')

  const bulkMode = computed({
    get: () => getBulkMode(),
    set: (value: boolean) => {
      if (config.value.market) config.value.market.bulkMode = value
      void patchMarketNextConfig({ bulkMode: value })
    },
  })

  const {
    versions,
    version,
    selectVersion,
    getOverride,
    getVersion,
    setVersion,
    getWorkspaceVersion,
    workspace,
    localSelection,
    shouldShowPeerVersionSelect,
    getPeerResolvedVersion,
    shouldFetchRegistry,
  } = useInstallVersions(bulkMode)

  function installDep(version: string, checkConfig = false, removeConfig = false) {
    const target = active.value
    if (!target) return

    // workspace packages don't need to be installed
    if (bulkMode.value && !workspace.value) {
      const override = getPendingOverrides()
      if (dep.value?.resolved === version || !version && !dep.value) {
        delete override[target]
      } else {
        override[target] = version
      }
      void patchMarketNextData({ override: { ...override } })
      active.value = ''
      return
    }

    // 1. The plugin is to be removed.
    // 2. The plugin has config entries.
    // 3. `removeConfig` is not set.
    if (checkConfig && getConfigWriter(ctx)?.get(target)?.length) {
      const savedRemoveConfig = getRemoveConfig()
      if (typeof savedRemoveConfig !== 'boolean') {
        showRemoveDialog.value = true
        return
      } else {
        removeConfig = savedRemoveConfig
      }
    }

    if (saveChoice.value) {
      if (config.value.market) config.value.market.removeConfig = removeConfig
      void patchMarketNextConfig({ removeConfig })
    }
    saveChoice.value = false
    showRemoveDialog.value = false

    versions[target] = version
    return install(versions, async () => {
      if (workspace.value) return
      if (version) {
        for (const key in versions) {
          await ensureInstalledConfig(ctx, key, key !== target)
        }
      } else if (removeConfig) {
        getConfigWriter(ctx)?.remove(target)
      }
      if (!version) {
        const records = getWritableBundleRecords()
        delete records[target]
        const saved = await patchMarketNextData({ bundleRecords: records })
        if (!saved) message.warning(t('operations.confirm.saveBundleFailed'))
      }
    })
  }

  const unchanged = computed(() => {
    return !data.value?.[version.value]
      || version.value === store.dependencies?.[active.value]?.request && !!store.dependencies?.[active.value]?.resolved
  })

  const dep = computed(() => store.dependencies?.[active.value])
  const current = computed(() => store.dependencies?.[active.value]?.resolved)
  const local = computed(() => store.packages?.[active.value])
  const bundleUninstallRecord = computed(() => {
    const target = bundleUninstallTarget.value
    if (!target || !isBundlePackageName(target)) return
    return getBundleRecords()[target] || createLocalBundleRecord(target)
  })

  const showRemoveButton = computed(() => {
    return current.value || store.dependencies?.[active.value] || bulkMode.value && getPendingOverrides()[active.value]
  })

  function requestRemove() {
    const target = active.value
    const record = target && (getBundleRecords()[target] || createLocalBundleRecord(target))
    if (target && record) {
      bundleUninstallTarget.value = target
      active.value = ''
      showBundleUninstallDialog.value = true
      return
    }
    installDep('', true)
  }

  const data = computed(() => {
    if (!active.value || localSelection.value) return
    return analyzeVersions(active.value, getVersion)
  })

  useInstallRegistrySync({ bulkMode, data, version, versions, shouldFetchRegistry })

  const registryStatus = computed(() => getRegistryStatus(active.value))

  const registryStatusText = computed(() => getRegistryStatusText(active.value))

  const danger = computed(() => {
    if (localSelection.value) return
    const deprecated = store.registry?.[active.value]?.[version.value]?.deprecated
    if (deprecated) return t('operations.install.deprecated', { reason: deprecated })
    if (getMarketObject(active.value)?.insecure) {
      return t('operations.install.insecure')
    }
  })

  const warning = computed(() => {
    if (!version.value || !current.value || localSelection.value) return
    try {
      const source = parse(current.value)
      const target = parse(version.value)
      if (source && target && (source.major !== target.major || !source.major && source.minor !== target.minor)) {
        return t('operations.install.majorWarning')
      }
    } catch {}
  })

  const result = computed(() => {
    if (!version.value || !data.value?.[version.value]) return
    const { result } = data.value[version.value]!
    if (result === 'danger' || danger.value) return 'danger'
    if (result === 'warning' || warning.value) return 'warning'
    return result
  })

  function configure() {
    getConfigWriter(ctx)?.ensure(active.value)
    closePanel()
  }

  function closePanel() {
    active.value = ''
  }

  function getResultIcon(type: ResultType) {
    switch (type) {
      case 'primary': return 'info-full'
      case 'warning': return 'exclamation-full'
      case 'danger': return 'times-full'
      case 'success': return 'check-full'
    }
  }

  function getResultText(peer: PeerInfo, name: string) {
    const isOverriden = name in getOverride()
    const isInstalled = store.packages ? !!store.packages[name] : !!store.dependencies?.[name]
    switch (peer.result) {
      case 'primary': return isOverriden ? t('operations.install.waitingRemove') : t('operations.install.optional')
      case 'danger': return peer.resolved ? t('operations.install.incompatible') : isOverriden ? t('operations.install.waitingRemove') : t('operations.install.notDownloaded')
      case 'success': return isOverriden ? isInstalled ? t('operations.install.waitingUpdate') : t('operations.install.waitingInstall') : t('operations.install.downloaded')
    }
  }

  return {
    t,
    active,
    modeClass,
    versionPopperClass,
    data,
    selectVersion,
    current,
    danger,
    warning,
    registryStatus,
    registryStatusText,
    bulkMode,
    local,
    localSelection,
    showRemoveButton,
    workspace,
    requestRemove,
    result,
    unchanged,
    installDep,
    configure,
    showRemoveDialog,
    saveChoice,
    showBundleUninstallDialog,
    bundleUninstallTarget,
    bundleUninstallRecord,
    version,
    getVersion,
    setVersion,
    shouldShowPeerVersionSelect,
    getPeerResolvedVersion,
    getWorkspaceVersion,
    getResultIcon,
    getResultText,
  }
}
