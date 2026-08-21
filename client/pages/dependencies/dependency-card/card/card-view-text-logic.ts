export interface CardDetailState {
  pendingRemove: boolean
  pending: boolean
  hasDependency: boolean
  localDependency: boolean
  dependencyInvalid: boolean
  dependencyBound?: boolean
  hasLocal: boolean
  bundlePackage: boolean
  unconfigured: boolean
  hasError: boolean
  hasData: boolean
  updateCheckDisabled: boolean
  ignoredUpdate: boolean
  updatable: boolean
  latestVersion?: string
}

export interface CardDetailMessages {
  t: (key: string, params?: Record<string, unknown>) => string
  registryStatus: () => string
  ignoredUpdate: () => string
}

export function resolveCardDetailText(state: CardDetailState, messages: CardDetailMessages) {
  if (state.pendingRemove) return messages.t('dependencyCard.detail.pendingRemove')
  if (state.pending && state.hasDependency) return messages.t('dependencyCard.detail.pendingApply')
  if (state.pending) return messages.t('dependencyCard.detail.pendingInstall')
  if (state.localDependency) {
    if (!state.hasDependency) return messages.t('dependencyCard.detail.localDiscovered')
    return state.dependencyBound === false
      ? messages.t('dependencyCard.detail.localUnbound')
      : messages.t('dependencyCard.detail.local')
  }
  if (state.dependencyInvalid) return messages.t('dependencyCard.detail.unsupported')
  if (state.bundlePackage && (state.hasDependency || state.hasLocal)) {
    return messages.t('dependencyCard.detail.bundle')
  }
  if (state.unconfigured) return messages.t('dependencyCard.detail.unconfigured')
  if (state.hasError) return messages.registryStatus()
  if (!state.hasData && !state.localDependency) return messages.registryStatus()
  if (state.updateCheckDisabled) return messages.t('dependencyCard.detail.checkDisabled')
  if (state.ignoredUpdate) {
    return messages.ignoredUpdate() || messages.t('dependencyCard.detail.ignored')
  }
  if (state.updatable && state.latestVersion) {
    return messages.t('dependencyCard.detail.foundUpdate', { version: state.latestVersion })
  }
  return ''
}
