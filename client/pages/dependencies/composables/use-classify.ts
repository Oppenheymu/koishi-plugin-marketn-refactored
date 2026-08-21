import { computed } from 'vue'
import { store, useContext, useConfig } from '@koishijs/client'
import { getBundleRecords, getPendingOverrides } from '../../../shared/config/data-store'
import { getMarketNextPolicy } from '../../../shared/config/market-config'
import { createLocalBundleRecord } from '../../../shared/install/bundle-records'
import { getConfigWriter, type ClientConfigWriter } from '../../../shared/install/config-writer'
import { getRegistryStatus } from '../../../shared/install/registry-status'
import { hasUpdate, isUpdateCheckDisabled, isUpdateIgnored } from '../../../shared/config/update-policy'
import { shouldIncludeDiscoveredLocalPlugin } from '../../../../src/shared/dependency-source'

export type FilterKey = 'all' | 'pending' | 'bundle' | 'unconfigured' | 'updatable' | 'ignored' | 'check-disabled' | 'invalid' | 'error' | 'local' | 'manual'
export type ItemKind = 'pending' | 'bundle' | 'unconfigured' | 'updatable' | 'ignored' | 'check-disabled' | 'invalid' | 'error' | 'local' | 'manual' | 'installed'

export interface DependencyItem {
  name: string
  kind: ItemKind
  pending: boolean
  manual: boolean
}

function resolveFirst<T>(
  rules: Array<{ when: () => boolean, value: T }>,
  fallback: T,
) {
  return rules.find(rule => rule.when)?.value ?? fallback
}

export function useClassify() {
  const config = useConfig()
  const ctx = useContext()

  function getOverride() {
    return getPendingOverrides()
  }

  function getUpdatePolicy() {
    return getMarketNextPolicy(config.value)
  }

  function isManageableBundle(name: string) {
    return !!(getBundleRecords(config.value)[name] || createLocalBundleRecord(name))
  }

  function isPluginPackage(name: string) {
    return /^@koishijs\/plugin-[0-9a-z-]+$/.test(name) || /(^|\/)koishi-plugin-[0-9a-z-]+$/.test(name)
  }

  function isUnconfigured(name: string, configWriter = getConfigWriter(ctx)) {
    if (isManageableBundle(name)) return false
    return !!configWriter && !!store.packages?.[name] && isPluginPackage(name) && !configWriter.get(name)?.length
  }

  function shouldIncludeName(name: string, pkg: NonNullable<typeof store.packages>[string], configWriter?: ClientConfigWriter) {
    if (isUnconfigured(name, configWriter) || isManageableBundle(name)) return true
    if (!isPluginPackage(name)) return false
    return shouldIncludeDiscoveredLocalPlugin({
      declared: !!store.dependencies?.[name],
      configured: !!configWriter?.get(name)?.length,
      running: !!pkg?.runtime?.id,
      workspace: !!pkg?.workspace,
    })
  }

  const names = computed(() => {
    const configWriter = getConfigWriter(ctx)
    const explicit: Record<string, unknown> = {
      ...(store.dependencies ?? {}),
      ...getOverride(),
    }
    for (const name of Object.keys(store.packages ?? {})) {
      const pkg = store.packages?.[name]
      if (pkg && shouldIncludeName(name, pkg, configWriter)) {
        explicit[name] = true
      }
    }
    return Object
      .keys(explicit)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  })

  function classify(name: string, configWriter?: ClientConfigWriter): ItemKind {
    const dep = store.dependencies?.[name]
    const override = getOverride()
    const pending = Object.prototype.hasOwnProperty.call(override, name)
    if (pending) return 'pending'
    if (!dep) return store.packages?.[name] ? 'local' : 'manual'
    if (dep.local || dep.workspace) return 'local'
    if (dep.invalid) return 'invalid'
    if (isManageableBundle(name)) return 'bundle'
    if (isUnconfigured(name, configWriter)) return 'unconfigured'
    const policy = getUpdatePolicy()
    const status = getRegistryStatus(name)
    return resolveFirst(
      [
        { when: () => !!status?.error, value: 'error' as const },
        { when: () => isUpdateCheckDisabled(name, policy), value: 'check-disabled' as const },
        { when: () => isUpdateIgnored(name, policy), value: 'ignored' as const },
        { when: () => hasUpdate(name, policy), value: 'updatable' as const },
      ],
      'installed',
    )
  }

  const items = computed<DependencyItem[]>(() => {
    const configWriter = getConfigWriter(ctx)
    return names.value.map(name => ({
      name,
      kind: classify(name, configWriter),
      pending: Object.prototype.hasOwnProperty.call(getOverride(), name),
      manual: !store.dependencies?.[name] && !store.packages?.[name],
    }))
  })

  const updates = computed(() => items.value.filter(item => item.kind === 'updatable').map(item => item.name))

  const prereleaseBlocked = computed(() => !!getUpdatePolicy().updateIgnorePrerelease)

  const summary = computed(() => {
    return {
      total: items.value.length,
      updatable: items.value.filter(item => item.kind === 'updatable').length,
      bundle: items.value.filter(item => item.kind === 'bundle').length,
      pending: Object.keys(getOverride()).length,
      unconfigured: items.value.filter(item => item.kind === 'unconfigured').length,
      ignored: items.value.filter(item => item.kind === 'ignored').length,
      checkDisabled: items.value.filter(item => item.kind === 'check-disabled').length,
      invalid: items.value.filter(item => item.kind === 'invalid').length,
      errors: items.value.filter(item => item.kind === 'error').length,
      local: items.value.filter(item => item.kind === 'local').length,
      manual: items.value.filter(item => item.manual).length,
    }
  })

  const refreshing = computed(() => {
    return Object.values((store as typeof store & { registryStatus?: Record<string, { loading?: boolean }> }).registryStatus ?? {})
      .some(status => status.loading)
  })

  return {
    getUpdatePolicy,
    names,
    items,
    updates,
    prereleaseBlocked,
    summary,
    refreshing,
  }
}
