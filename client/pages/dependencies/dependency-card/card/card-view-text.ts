import { computed } from 'vue'
import { getMarketNextPolicy } from '../../../../shared/config/market-config'
import { getUpdateIgnoreText } from '../../../../shared/config/update-policy'
import { getConfigWriter } from '../../../../shared/install/config-writer'
import { formatEndpoint, getRegistryStatusText } from '../../../../shared/install/registry-status'
import { formatPackageDisplayName, isPluginPackage } from '../identity'
import type { CardViewContext } from './card-view-context'
import { resolveCardDetailText } from './card-view-text-logic'

/** 依赖卡片的文案/图标类展示计算（自 useCardView 拆出）。 */
export function useCardText(input: CardViewContext) {
  const { props, ctx, t } = input
  const { dep, local, localDependency, bundleRecord, bundleOrigin } = input
  const { status, latestVersion, overrideValue, pending, pendingRemove } = input
  const { updateCheckDisabled, ignoredUpdate, updatable, bundlePackage, unconfigured } = input
  const { statusClass, editing } = input

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
    return resolveCardDetailText({
      pendingRemove: pendingRemove.value,
      pending: pending.value,
      hasDependency: !!dep.value,
      localDependency: localDependency.value,
      dependencyInvalid: !!dep.value?.invalid,
      dependencyBound: dep.value?.bound,
      hasLocal: !!local.value,
      bundlePackage: bundlePackage.value,
      unconfigured: unconfigured.value,
      hasError: !!status.value?.error,
      hasData: !!input.data.value,
      updateCheckDisabled: updateCheckDisabled.value,
      ignoredUpdate: ignoredUpdate.value,
      updatable: updatable.value,
      latestVersion: latestVersion.value,
    }, {
      t,
      registryStatus: () => getRegistryStatusText(props.name),
      ignoredUpdate: () => getUpdateIgnoreText(props.name, getMarketNextPolicy()),
    })
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
    if (!input.data.value && dep.value) return t('dependencyCard.target.waiting')
    return ''
  })

  return {
    statusLabel,
    statusIcon,
    badgeIcon,
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
  }
}
