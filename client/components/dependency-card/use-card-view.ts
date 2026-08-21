import { computed } from 'vue'
import type { ComputedRef, Ref, WritableComputedRef } from 'vue'
import type { Context } from '@koishijs/client'
import type { SearchObject } from '@koishijs/registry'
import type { RegistryStatus } from 'koishi-plugin-marketn-refactored'
import type { PluginBundleRecord } from '../../../src/shared/bundle'
import { getMarketNextPolicy } from '../../lib/market-config'
import { getUpdateIgnoreText } from '../../lib/update-policy'
import { getConfigWriter } from '../../lib/config-writer'
import { formatEndpoint, getRegistryStatusText } from '../../lib/registry-status'
import { formatPackageDisplayName, isPluginPackage, pickDescription, resolveIdentity } from './identity'
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

export function useCardView(input: CardViewContext) {
  const { props, ctx, t, locale } = input
  const { dep, local, localDependency, marketData, bundleRecord, bundleOrigin, displayName, data } = input
  const { status, latestVersion, overrideValue, pending, pendingRemove } = input
  const { updateCheckDisabled, ignoredUpdate, updatable, bundlePackage, unconfigured } = input
  const { statusClass, canExpandCard, selectedVersion, editing } = input

  function getUpdatePolicy() {
    return getMarketNextPolicy()
  }

  const statusLabel = computed(() => {
    if (pendingRemove.value) return t('dependencyCard.status.pendingRemove')
    if (pending.value && dep.value) return t('dependencyCard.status.pendingApply')
    if (pending.value) return t('dependencyCard.status.pendingInstall')
    if (localDependency.value) return t('dependencyCard.status.local')
    if (dep.value?.invalid) return t('dependencyCard.status.unsupported')
    if (bundlePackage.value && (dep.value || local.value)) return t('dependencyCard.status.bundle')
    if (unconfigured.value) return t('dependencyCard.status.unconfigured')
    if (status.value?.error) return t('dependencyCard.status.versionError')
    if (!dep.value && !local.value) return t('dependencyCard.status.manual')
    if (updateCheckDisabled.value) return t('dependencyCard.status.checkDisabled')
    if (ignoredUpdate.value) return t('dependencyCard.status.ignored')
    if (updatable.value) return t('dependencyCard.status.updatable')
    return t('dependencyCard.status.installed')
  })

  const statusIcon = computed(() => {
    if (pendingRemove.value) return 'close'
    if (pending.value) return 'tag'
    if (bundlePackage.value && (dep.value || local.value)) return 'file-archive'
    if (unconfigured.value) return 'preview'
    if (dep.value?.invalid) return 'insecure'
    if (status.value?.error) return 'insecure'
    if (localDependency.value) return 'file-archive'
    if (!dep.value) return 'search'
    if (updateCheckDisabled.value) return 'installed'
    if (ignoredUpdate.value) return 'installed'
    if (updatable.value) return 'asc'
    return 'installed'
  })

  const badgeIcon = computed(() => statusIcon.value)

  const markIcon = computed(() => {
    if (statusClass.value === 'installed') return identityIcon.value
    return statusIcon.value
  })

  const currentText = computed(() => {
    if (!dep.value) return local.value?.package.version ?? t('dependencyCard.current.notInstalled')
    if (localDependency.value) return dep.value.resolved ? `${dep.value.resolved} / ${t('dependencyCard.current.local')}` : t('dependencyCard.current.local')
    return dep.value.resolved ?? t('dependencyCard.current.installError')
  })

  const targetText = computed(() => {
    if (pendingRemove.value) return t('dependencyCard.target.remove')
    if (overrideValue.value) return overrideValue.value
    if (updatable.value && latestVersion.value) return latestVersion.value
    if (ignoredUpdate.value && latestVersion.value) return latestVersion.value
    if (localDependency.value) return t('dependencyCard.target.keepLocal')
    if (statusClass.value === 'installed' && dep.value && !dep.value.local && !dep.value.workspace) {
      if (dep.value.latest) return dep.value.latest
      if (status.value?.loading) return t('dependencyCard.target.loading')
    }
    if (latestVersion.value) return latestVersion.value
    return dep.value || local.value ? t('dependencyCard.target.waitingData') : t('dependencyCard.target.waitingInstall')
  })

  const targetLabel = computed(() => {
    if (pending.value) return t('dependencyCard.label.pending')
    if (updatable.value) return t('dependencyCard.label.latest')
    if (ignoredUpdate.value) return t('dependencyCard.label.ignored')
    if (dep.value || local.value) return t('dependencyCard.label.latest')
    return t('dependencyCard.label.target')
  })

  const detailText = computed(() => {
    if (pendingRemove.value) return t('dependencyCard.detail.pendingRemove')
    if (pending.value && dep.value) return t('dependencyCard.detail.pendingApply')
    if (pending.value) return t('dependencyCard.detail.pendingInstall')
    if (localDependency.value) {
      if (!dep.value) return t('dependencyCard.detail.localDiscovered')
      return dep.value.bound === false
        ? t('dependencyCard.detail.localUnbound')
        : t('dependencyCard.detail.local')
    }
    if (dep.value?.invalid) return t('dependencyCard.detail.unsupported')
    if (bundlePackage.value && (dep.value || local.value)) return t('dependencyCard.detail.bundle')
    if (unconfigured.value) return t('dependencyCard.detail.unconfigured')
    if (status.value?.error) return getRegistryStatusText(props.name)
    if (!data.value && !localDependency.value) return getRegistryStatusText(props.name)
    if (updateCheckDisabled.value) return t('dependencyCard.detail.checkDisabled')
    if (ignoredUpdate.value) return getUpdateIgnoreText(props.name, getUpdatePolicy()) || t('dependencyCard.detail.ignored')
    if (updatable.value && latestVersion.value) return t('dependencyCard.detail.foundUpdate', { version: latestVersion.value })
    return ''
  })

  const compactStatusText = computed(() => {
    if (localDependency.value) return dep.value?.bound === false
      ? t('dependencyCard.detail.localUnboundShort')
      : t('dependencyCard.detail.localShort')
    if (dep.value?.invalid) return t('dependencyCard.detail.unsupportedShort')
    return status.value?.loading || !status.value ? t('dependencyCard.detail.fetching') : t('dependencyCard.detail.noData')
  })

  const configText = computed(() => {
    if (bundlePackage.value) return t('dependencyCard.config.notNeeded')
    if (!isPluginPackage(props.name)) return t('dependencyCard.config.notPlugin')
    if (!getConfigWriter(ctx)) return t('dependencyCard.config.unknown')
    if (!local.value) return pending.value ? t('dependencyCard.config.pending') : t('dependencyCard.config.notLoaded')
    return unconfigured.value ? t('dependencyCard.config.unconfigured') : t('dependencyCard.config.configured')
  })

  const sourceText = computed(() => {
    if (bundleOrigin.value) return t('dependencyCard.source.bundle', { name: bundleOrigin.value.label || formatPackageDisplayName(bundleOrigin.value.package) })
    if (bundleRecord.value) return t('dependencyCard.source.bundleSelf')
    if (dep.value?.source) return t(`dependencyCard.source.${dep.value.source}`)
    if (localDependency.value) return local.value?.workspace
      ? t('dependencyCard.source.workspace')
      : t('dependencyCard.source.local')
    if (dep.value?.workspace || local.value?.workspace) return t('dependencyCard.source.workspace')
    if (pending.value && !dep.value) return t('dependencyCard.source.pending')
    if (!dep.value && local.value) return t('dependencyCard.source.local')
    if (!dep.value) return t('dependencyCard.source.manual')
    return t('dependencyCard.source.packageJson')
  })

  const removeButtonText = computed(() => bundleRecord.value ? t('dependencyCard.actions.uninstallBundle') : t('dependencyCard.actions.uninstall'))

  const requestText = computed(() => {
    if (!dep.value?.request) return ''
    if (dep.value.request === dep.value.resolved) return ''
    return dep.value.request
  })

  const versionSourceText = computed(() => {
    if (statusClass.value === 'installed' && !editing.value) return ''
    if (localDependency.value) return ''
    if (status.value?.endpoint) return formatEndpoint(status.value.endpoint)
    if (status.value?.loading) return t('dependencyCard.target.loading')
    if (!data.value && dep.value) return t('dependencyCard.target.waiting')
    return ''
  })

  const identity = computed(() => resolveIdentity(props.name))

  const identityText = computed(() => t(identity.value.label))
  const identityIcon = computed(() => identity.value.icon)

  const cardStyle = computed(() => {
    if (statusClass.value !== 'installed') return {}
    return {
      '--dep-accent': identity.value.color,
    }
  })

  const showIdentityPill = computed(() => statusClass.value === 'installed')

  const showIdentityMeta = computed(() => statusClass.value !== 'installed')

  const showStatusBadge = computed(() => statusClass.value !== 'installed')

  const showConfigMeta = computed(() => statusClass.value !== 'installed' || configText.value !== t('dependencyCard.config.configured'))

  const showSourceMeta = computed(() => statusClass.value !== 'installed' || sourceText.value !== t('dependencyCard.source.packageJson'))

  const summaryText = computed(() => {
    if (statusClass.value !== 'installed') return ''
    return pickDescription(marketData.value?.manifest?.description, locale.value)
      || pickDescription(marketData.value?.package?.description, locale.value)
      // store.packages 的 package 字段在宿主类型里只 Pick 了 name/version/peerDependencies，
      // 但运行时是完整 package.json，description 从这里取
      || pickDescription((local.value?.package as { description?: string })?.description, locale.value)
  })

  const showTargetMeta = computed(() => {
    if (pending.value || updatable.value || ignoredUpdate.value) return true
    if (statusClass.value === 'manual' || statusClass.value === 'error') return true
    return !!(dep.value || local.value) && !localDependency.value
  })

  const showDetailText = computed(() => {
    return !!detailText.value && statusClass.value !== 'installed'
  })

  const showVersionControl = computed(() => {
    if (localDependency.value) return false
    if (!data.value && !status.value?.error) return false
    return editing.value || pending.value || updatable.value || statusClass.value === 'error' || statusClass.value === 'manual'
  })

  const editToggleText = computed(() => {
    if (bundlePackage.value) return t('dependencyCard.actions.manage')
    if (editing.value) return t('dependencyCard.actions.collapse')
    return data.value ? (props.listMode ? t('dependencyCard.actions.versions') : t('dependencyCard.actions.edit')) : t('dependencyCard.actions.operate')
  })

  const showEditToggle = computed(() => {
    if (bundlePackage.value && (dep.value || local.value)) return !pending.value
    return canExpandCard.value && !updatable.value
  })

  const showQuickUpdate = computed(() => {
    return !pending.value && !unconfigured.value && updatable.value && !!latestVersion.value && !localDependency.value
  })

  const showInlineIgnoreUpdate = computed(() => {
    return showQuickUpdate.value
  })

  const showRestoreUpdate = computed(() => {
    return !pending.value && !localDependency.value && ignoredUpdate.value
  })

  const showConfigure = computed(() => {
    return !pending.value && unconfigured.value
  })

  const showBindLocal = computed(() => {
    return !pending.value && dep.value?.source === 'unbound' && dep.value?.bound === false
  })

  const showRemoveDependency = computed(() => {
    return (props.listMode || editing.value || statusClass.value !== 'installed')
      && !pending.value
      && !!dep.value
      && !dep.value.workspace
      && !dep.value.invalid
  })

  const showCardActions = computed(() => {
    return showVersionControl.value || showQuickUpdate.value || showRestoreUpdate.value || showConfigure.value || showBindLocal.value || showRemoveDependency.value || pending.value
  })

  const floatingActions = computed(() => {
    return editing.value && statusClass.value === 'installed'
  })

  return {
    statusLabel,
    statusIcon,
    badgeIcon,
    markIcon,
    currentText,
    targetText,
    targetLabel,
    detailText,
    compactStatusText,
    configText,
    sourceText,
    removeButtonText,
    requestText,
    versionSourceText,
    identity,
    identityText,
    identityIcon,
    cardStyle,
    showIdentityPill,
    showIdentityMeta,
    showStatusBadge,
    showConfigMeta,
    showSourceMeta,
    summaryText,
    showTargetMeta,
    showDetailText,
    showVersionControl,
    editToggleText,
    showEditToggle,
    showQuickUpdate,
    showInlineIgnoreUpdate,
    showRestoreUpdate,
    showConfigure,
    showBindLocal,
    showRemoveDependency,
    showCardActions,
    floatingActions,
  }
}
