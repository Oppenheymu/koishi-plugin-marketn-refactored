import { computed } from 'vue'
import { pickDescription, resolveIdentity } from '../identity'
import { useCardText } from './card-view-text'
import type { CardViewContext } from './card-view-context'

export type { CardViewContext } from './card-view-context'

export function useCardView(input: CardViewContext) {
  const { props, locale } = input
  const { dep, local, localDependency, marketData } = input
  const { pending, ignoredUpdate, updatable, unconfigured } = input
  const { statusClass, canExpandCard, editing } = input

  const {
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
  } = useCardText(input)

  const identity = computed(() => resolveIdentity(props.name))

  const identityText = computed(() => input.t(identity.value.label))
  const identityIcon = computed(() => identity.value.icon)

  const markIcon = computed(() => {
    if (statusClass.value === 'installed') return identityIcon.value
    return statusIcon.value
  })

  const cardStyle = computed(() => {
    if (statusClass.value !== 'installed') return {}
    return {
      '--dep-accent': identity.value.color,
    }
  })

  const showIdentityPill = computed(() => statusClass.value === 'installed')

  const showIdentityMeta = computed(() => statusClass.value !== 'installed')

  const showStatusBadge = computed(() => statusClass.value !== 'installed')

  const showConfigMeta = computed(() => statusClass.value !== 'installed' || configText.value !== input.t('dependencyCard.config.configured'))

  const showSourceMeta = computed(() => statusClass.value !== 'installed' || sourceText.value !== input.t('dependencyCard.source.packageJson'))

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
    if (!input.data.value && !input.status.value?.error) return false
    return editing.value || pending.value || updatable.value || statusClass.value === 'error' || statusClass.value === 'manual'
  })

  const editToggleText = computed(() => {
    if (input.bundlePackage.value) return input.t('dependencyCard.actions.manage')
    if (editing.value) return input.t('dependencyCard.actions.collapse')
    return input.data.value ? (props.listMode ? input.t('dependencyCard.actions.versions') : input.t('dependencyCard.actions.edit')) : input.t('dependencyCard.actions.operate')
  })

  const showEditToggle = computed(() => {
    if (input.bundlePackage.value && (dep.value || local.value)) return !pending.value
    return canExpandCard.value && !updatable.value
  })

  const showQuickUpdate = computed(() => {
    return !pending.value && !unconfigured.value && updatable.value && !!input.latestVersion.value && !localDependency.value
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
