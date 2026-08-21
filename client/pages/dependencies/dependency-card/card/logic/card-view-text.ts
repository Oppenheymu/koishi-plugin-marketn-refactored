import { computed } from 'vue'
import { getMarketNextPolicy } from '../../../../../shared/config/market-config'
import { getUpdateIgnoreText } from '../../../../../shared/config/update-policy'
import { getConfigWriter } from '../../../../../shared/install/config-writer'
import { formatEndpoint, getRegistryStatusText } from '../../../../../shared/install/registry-status'
import { formatPackageDisplayName, isPluginPackage } from '../../identity'
  import type { CardViewContext } from './card-view-context'
  import { resolveCardDetailText } from './card-view-text-logic'

function resolveFirst<T>(
  rules: Array<{ when: () => boolean, value: () => T }>,
  fallback: () => T,
) {
  return (rules.find(rule => rule.when)?.value ?? fallback)()
}

/** 依赖卡片的文案/图标类展示计算（自 useCardView 拆出）。 */
export function useCardText(input: CardViewContext) {
  const { props, ctx, t } = input
  const { dep, local, localDependency, bundleRecord, bundleOrigin } = input
  const { status, latestVersion, overrideValue, pending, pendingRemove } = input
  const { updateCheckDisabled, ignoredUpdate, updatable, bundlePackage, unconfigured } = input
  const { statusClass, editing } = input

  const statusLabelRules = [
    { when: () => pendingRemove.value, value: () => t('dependencyCard.status.pendingRemove') },
    { when: () => pending.value && !!dep.value, value: () => t('dependencyCard.status.pendingApply') },
    { when: () => pending.value, value: () => t('dependencyCard.status.pendingInstall') },
    { when: () => localDependency.value, value: () => t('dependencyCard.status.local') },
    { when: () => !!dep.value?.invalid, value: () => t('dependencyCard.status.unsupported') },
    { when: () => bundlePackage.value && !!(dep.value || local.value), value: () => t('dependencyCard.status.bundle') },
    { when: () => unconfigured.value, value: () => t('dependencyCard.status.unconfigured') },
    { when: () => !!status.value?.error, value: () => t('dependencyCard.status.versionError') },
    { when: () => !dep.value && !local.value, value: () => t('dependencyCard.status.manual') },
    { when: () => updateCheckDisabled.value, value: () => t('dependencyCard.status.checkDisabled') },
    { when: () => ignoredUpdate.value, value: () => t('dependencyCard.status.ignored') },
    { when: () => updatable.value, value: () => t('dependencyCard.status.updatable') },
  ]
  const statusLabel = computed(() => resolveFirst(statusLabelRules, () => t('dependencyCard.status.installed')))

  const statusIconRules = [
    { when: () => pendingRemove.value, value: () => 'close' },
    { when: () => pending.value, value: () => 'tag' },
    { when: () => bundlePackage.value && !!(dep.value || local.value), value: () => 'file-archive' },
    { when: () => unconfigured.value, value: () => 'preview' },
    { when: () => !!dep.value?.invalid || !!status.value?.error, value: () => 'insecure' },
    { when: () => localDependency.value, value: () => 'file-archive' },
    { when: () => !dep.value, value: () => 'search' },
    { when: () => updateCheckDisabled.value || ignoredUpdate.value, value: () => 'installed' },
    { when: () => updatable.value, value: () => 'asc' },
  ]
  const statusIcon = computed(() => resolveFirst(statusIconRules, () => 'installed'))

  const badgeIcon = computed(() => statusIcon.value)

  const currentText = computed(() => {
    if (!dep.value) return local.value?.package.version ?? t('dependencyCard.current.notInstalled')
    if (localDependency.value) return dep.value.resolved ? `${dep.value.resolved} / ${t('dependencyCard.current.local')}` : t('dependencyCard.current.local')
    return dep.value.resolved ?? t('dependencyCard.current.installError')
  })

  const targetTextRules = [
    { when: () => pendingRemove.value, value: () => t('dependencyCard.target.remove') },
    { when: () => !!overrideValue.value, value: () => overrideValue.value! },
    { when: () => updatable.value && !!latestVersion.value, value: () => latestVersion.value! },
    { when: () => ignoredUpdate.value && !!latestVersion.value, value: () => latestVersion.value! },
    { when: () => localDependency.value, value: () => t('dependencyCard.target.keepLocal') },
    {
      when: () => statusClass.value === 'installed' && !!dep.value && !dep.value.local && !dep.value.workspace && !!dep.value.latest,
      value: () => dep.value!.latest!,
    },
    {
      when: () => statusClass.value === 'installed' && !!dep.value && !dep.value.local && !dep.value.workspace && !dep.value.latest && !!status.value?.loading,
      value: () => t('dependencyCard.target.loading'),
    },
    { when: () => !!latestVersion.value, value: () => latestVersion.value! },
  ]
  const targetText = computed(() => resolveFirst(
    targetTextRules,
    () => dep.value || local.value
      ? t('dependencyCard.target.waitingData')
      : t('dependencyCard.target.waitingInstall'),
  ))

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

  const sourceTextRules = [
    {
      when: () => !!bundleOrigin.value,
      value: () => t('dependencyCard.source.bundle', {
        name: bundleOrigin.value!.label || formatPackageDisplayName(bundleOrigin.value!.package),
      }),
    },
    { when: () => !!bundleRecord.value, value: () => t('dependencyCard.source.bundleSelf') },
    { when: () => !!dep.value?.source, value: () => t(`dependencyCard.source.${dep.value!.source}`) },
    {
      when: () => localDependency.value && !!local.value?.workspace,
      value: () => t('dependencyCard.source.workspace'),
    },
    { when: () => localDependency.value, value: () => t('dependencyCard.source.local') },
    {
      when: () => !!dep.value?.workspace || !!local.value?.workspace,
      value: () => t('dependencyCard.source.workspace'),
    },
    { when: () => pending.value && !dep.value, value: () => t('dependencyCard.source.pending') },
    { when: () => !dep.value && !!local.value, value: () => t('dependencyCard.source.local') },
    { when: () => !dep.value, value: () => t('dependencyCard.source.manual') },
  ]
  const sourceText = computed(() => resolveFirst(
    sourceTextRules,
    () => t('dependencyCard.source.packageJson'),
  ))

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
