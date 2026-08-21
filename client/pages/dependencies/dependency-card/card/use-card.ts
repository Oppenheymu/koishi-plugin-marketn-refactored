import { computed, ref, type InjectionKey } from 'vue'
import { store, useContext } from '@koishijs/client'
import { isLocalDependency } from '../../../../../src/shared/dependency-source'
import { getMarketNextPolicy } from '../../../../shared/config/market-config'
import { useMarketModeClass } from '../../../../shared/ui/market-mode'
import { getBundleRecords, getPendingOverrides, patchMarketNextData } from '../../../../shared/config/data-store'
import { getIgnoredUpdateVersion, getLatestVersion, hasUpdate, isUpdateCheckDisabled, isUpdateIgnored } from '../../../../shared/config/update-policy'
import { expandedDependency } from '../../../../shared/ui/dialogs'
import { analyzeVersions } from '../../../../shared/install/analyze-versions'
import { createLocalBundleRecord } from '../../../../shared/install/bundle-records'
import { getConfigWriter } from '../../../../shared/install/config-writer'
import { getRegistryStatus } from '../../../../shared/install/registry-status'
import { getMarketObject } from '../../../../market/state/lookup'
import { useMarketNextI18n } from '../../../../i18n'
import { formatPackageDisplayName, isPluginPackage } from '../identity'
import { useIgnoreUpdate } from '../use-ignore-update'
import { useCardView } from './use-card-view'
import { useCardActions } from './use-card-actions'

export type ItemKind = 'pending' | 'bundle' | 'unconfigured' | 'updatable' | 'ignored' | 'check-disabled' | 'invalid' | 'error' | 'local' | 'manual' | 'installed'

export interface DependencyCardProps {
  name: string
  kind?: ItemKind
  listMode?: boolean
}

/** 卡片子组件共享的上下文（useCard 结果 + 传入 props），经 provide/inject 下发。 */
export const cardContextKey: InjectionKey<{
  card: ReturnType<typeof useCard>
  props: DependencyCardProps
}> = Symbol('dep-card')

export function useCard(props: DependencyCardProps) {
  const removeValue = '__market_next_remove__'
  const ctx = useContext()
  const { t, locale } = useMarketNextI18n()
  const { modeClass, versionPopperClass } = useMarketModeClass()
  const configuring = ref(false)
  const editing = computed({
    get: () => expandedDependency.value === props.name,
    set: (value: boolean) => expandedDependency.value = value ? props.name : '',
  })
  const showIgnoreDialog = ref(false)
  const showBundleUninstallDialog = ref(false)
  const showLocalBindingDialog = ref(false)
  const bindingLocal = ref(false)

  const dep = computed(() => store.dependencies?.[props.name])
  const local = computed(() => store.packages?.[props.name])
  const localDependency = computed(() => {
    return isLocalDependency(dep.value)
      || props.kind === 'local' && !dep.value && !!local.value
  })
  const marketData = computed(() => getMarketObject(props.name))
  const bundleRecord = computed(() => getBundleRecords()[props.name] || createLocalBundleRecord(props.name))

  const displayName = computed(() => formatPackageDisplayName(props.name))

  const data = computed(() => {
    if (localDependency.value || dep.value?.invalid) return
    return analyzeVersions(props.name, (name) => getPendingOverrides()[name]!)
  })

  function getUpdatePolicy() {
    return getMarketNextPolicy()
  }

  const status = computed(() => getRegistryStatus(props.name))

  const latestVersion = computed(() => {
    const latest = getLatestVersion(props.name, getUpdatePolicy())
    if (latest) return latest
    const ignored = getIgnoredUpdateVersion(props.name, getUpdatePolicy())
    if (ignored) return ignored
    return dep.value?.latest ?? local.value?.package.version
  })

  const overrideValue = computed(() => {
    const override = getPendingOverrides()
    if (!Object.prototype.hasOwnProperty.call(override, props.name)) return
    return override[props.name]
  })

  const pending = computed(() => overrideValue.value !== undefined)
  const pendingRemove = computed(() => pending.value && !overrideValue.value)
  const updateCheckDisabled = computed(() => isUpdateCheckDisabled(props.name, getUpdatePolicy()))
  const ignoredUpdate = computed(() => updateCheckDisabled.value || isUpdateIgnored(props.name, getUpdatePolicy()))
  const updatable = computed(() => !!hasUpdate(props.name, getUpdatePolicy()))
  const bundlePackage = computed(() => !!bundleRecord.value)
  const unconfigured = computed(() => {
    if (bundlePackage.value) return false
    const configWriter = getConfigWriter(ctx)
    return !!configWriter && !!local.value && isPluginPackage(props.name) && !configWriter.get(props.name)?.length
  })

  const selectedVersion = computed({
    get() {
      if (pendingRemove.value) return removeValue
      if (overrideValue.value) return overrideValue.value
      return dep.value?.resolved ?? latestVersion.value ?? ''
    },
    set(value: string) {
      if (value === removeValue) {
        getPendingOverrides()[props.name] = ''
      } else if (value === dep.value?.resolved || !value && !dep.value) {
        delete getPendingOverrides()[props.name]
      } else {
        getPendingOverrides()[props.name] = value
      }
      void patchMarketNextData({ override: { ...getPendingOverrides() } })
    },
  })

  const statusClass = computed<ItemKind>(() => {
    if (pending.value) return 'pending'
    if (localDependency.value) return 'local'
    if (dep.value?.invalid) return 'invalid'
    if (bundlePackage.value && (dep.value || local.value)) return 'bundle'
    if (unconfigured.value) return 'unconfigured'
    if (status.value?.error) return 'error'
    if (!dep.value && !local.value) return 'manual'
    if (updateCheckDisabled.value) return 'check-disabled'
    if (ignoredUpdate.value) return 'ignored'
    if (updatable.value) return 'updatable'
    return props.kind ?? 'installed'
  })

  const canExpandCard = computed(() => {
    if (bundlePackage.value && (dep.value || local.value)) return !pending.value
    if (pending.value || statusClass.value === 'error' || statusClass.value === 'manual') return false
    if (localDependency.value) return false
    if (data.value) return true
    return !!dep.value && !dep.value.workspace && !dep.value.invalid
  })

  const actions = useCardActions({
    props, ctx, t, removeValue,
    editing, configuring, showBundleUninstallDialog, showLocalBindingDialog, bindingLocal,
    dep, local, marketData, bundleRecord, bundlePackage, displayName, latestVersion,
    selectedVersion, canExpandCard,
  })
  const { findBundleOrigin } = actions

  const bundleOrigin = computed(() => findBundleOrigin(props.name))

  const view = useCardView({
    props, ctx, t, locale,
    dep, local, localDependency, marketData, bundleRecord, bundleOrigin, displayName, data,
    status, latestVersion, overrideValue, pending, pendingRemove,
    updateCheckDisabled, ignoredUpdate, updatable, bundlePackage, unconfigured,
    statusClass, canExpandCard, selectedVersion, editing,
  })

  const ignore = useIgnoreUpdate(props, showIgnoreDialog)

  return {
    removeValue,
    modeClass,
    versionPopperClass,
    configuring,
    editing,
    showIgnoreDialog,
    showBundleUninstallDialog,
    showLocalBindingDialog,
    bindingLocal,
    dep,
    local,
    localDependency,
    marketData,
    bundleRecord,
    bundleOrigin,
    displayName,
    data,
    status,
    latestVersion,
    overrideValue,
    pending,
    pendingRemove,
    updateCheckDisabled,
    ignoredUpdate,
    updatable,
    bundlePackage,
    unconfigured,
    selectedVersion,
    statusClass,
    canExpandCard,
    ...view,
    toggleCardActions: actions.toggleCardActions,
    toggleEdit: actions.toggleEdit,
    openBundlePanel: actions.openBundlePanel,
    clearOverride: actions.clearOverride,
    removeDependency: actions.removeDependency,
    openLocalBinding: actions.openLocalBinding,
    confirmLocalBinding: actions.confirmLocalBinding,
    configure: actions.configure,
    ignoreDurationPreset: ignore.ignoreDurationPreset,
    ignoreCustomDays: ignore.ignoreCustomDays,
    ignoreCount: ignore.ignoreCount,
    ignorePackagePermanently: ignore.ignorePackagePermanently,
    ignoreSaving: ignore.ignoreSaving,
    openIgnoreDialog: ignore.openIgnoreDialog,
    confirmIgnoreUpdate: ignore.confirmIgnoreUpdate,
    restoreUpdate: ignore.restoreUpdate,
  }
}
