import { computed, reactive, ref, watch } from 'vue'
import { message, router, send, store, useContext } from '@koishijs/client'
import { getBundleGroupIdent } from '../../../src/shared/bundle-idents'
import type { PluginBundleRecord } from '../../../src/shared/bundle'
import { fetchBundleRecord, getBundleMemberConfigState, type BundleRecordView } from '../../shared/install/bundle-records'
import { install } from '../../shared/install/install-flow'
import { pendingBundleUninstalls, type BundleMemberCleanupTarget } from '../../shared/ui/dialogs'
import { getBulkMode } from '../../shared/config/market-config'
import { useMarketModeClass } from '../../shared/ui/market-mode'
import { getPendingOverrides, getWritableBundleRecords, patchMarketNextData } from '../../shared/config/data-store'
import { useMarketNextI18n } from '../../i18n'

type MemberAction = 'config' | 'dependency' | 'keep'

export interface BundleUninstallProps {
  modelValue: boolean
  packageName?: string
  record?: BundleRecordView | PluginBundleRecord
  title?: string
  redirectToPlugins?: boolean
}

export interface BundleUninstallEmits {
  (event: 'update:modelValue', value: boolean): void
  (event: 'done'): void
}

const protectedDeps = new Set(['@koishijs/plugin-console', '@koishijs/plugin-config', '@koishijs/plugin-server'])

export function useBundleUninstall(props: Readonly<BundleUninstallProps>, emit: BundleUninstallEmits) {
  const { t } = useMarketNextI18n()
  const { modeClass } = useMarketModeClass()

  function setAllActions(action: MemberAction) {
    for (const row of memberRows.value) {
      if (action === 'dependency') {
        memberActions[row.package] = row.canRemoveDependency ? 'dependency' : (row.hasGroupConfig ? 'config' : 'keep')
      } else if (action === 'config') {
        memberActions[row.package] = row.hasGroupConfig ? 'config' : 'keep'
      } else {
        memberActions[row.package] = 'keep'
      }
    }
  }

  const ctx = useContext()
  const loadingRecord = ref(false)
  const uninstalling = ref(false)
  const remoteRecord = ref<BundleRecordView>()
  const memberActions = reactive<Record<string, MemberAction>>({})

  const packageName = computed(() => props.packageName || '')
  const visible = computed({
    get: () => props.modelValue,
    set: value => emit('update:modelValue', value),
  })

  const recordView = computed(() => {
    if (props.record?.members?.length) return props.record
    if (remoteRecord.value?.package === packageName.value) return remoteRecord.value
    return props.record
  })

  const memberRows = computed(() => {
    const groupKey = recordView.value?.groupKey || (packageName.value ? `group:${getBundleGroupIdent(packageName.value)}` : undefined)
    return (recordView.value?.members ?? []).map((member) => {
      const dep = store.dependencies?.[member.package]
      const state = getBundleMemberConfigState(ctx, member, groupKey)
      const installed = !!dep
      const blocked = !!dep?.workspace || !!dep?.invalid || protectedDeps.has(member.package)
      const hasExternalConfig = !!state.external.length
      return {
        ...member,
        installed,
        workspace: !!dep?.workspace,
        hasGroupConfig: !!state.group.length,
        hasExternalConfig,
        canRemoveDependency: installed && !blocked && !hasExternalConfig,
      }
    })
  })

  const dependencyRemovalMembers = computed(() => memberRows.value
    .filter(row => memberActions[row.package] === 'dependency' && row.canRemoveDependency))
  const configCleanupMembers = computed(() => memberRows.value
    .filter(row => memberActions[row.package] === 'dependency' || memberActions[row.package] === 'config')
    .filter(row => row.hasGroupConfig))
  const dependencyRemovalCount = computed(() => dependencyRemovalMembers.value.length)
  const configCleanupCount = computed(() => configCleanupMembers.value.length)
  const keepCount = computed(() => Math.max(0, memberRows.value.length - new Set([
    ...dependencyRemovalMembers.value.map(row => row.package),
    ...configCleanupMembers.value.map(row => row.package),
  ]).size))

  watch(visible, async (value) => {
    if (!value) return
    remoteRecord.value = undefined
    await loadRecord()
    resetActions()
  }, { immediate: true })

  watch(memberRows, () => {
    if (visible.value) resetActions(false)
  })

  async function loadRecord() {
    const name = packageName.value
    if (!name || props.record?.members?.length) return
    loadingRecord.value = true
    try {
      const record = await fetchBundleRecord(name)
      if (record) remoteRecord.value = record
    } catch (error) {
      console.warn(error)
      message.warning(t('bundle.messages.recordFailed'))
    } finally {
      loadingRecord.value = false
    }
  }

  function resetActions(force = true) {
    const seen = new Set<string>()
    for (const row of memberRows.value) {
      seen.add(row.package)
      if (!force && memberActions[row.package]) continue
      memberActions[row.package] = getDefaultAction(row)
    }
    for (const key of Object.keys(memberActions)) {
      if (!seen.has(key)) delete memberActions[key]
    }
  }

  function getDefaultAction(row: (typeof memberRows.value)[number]): MemberAction {
    if (row.hasExternalConfig) return row.hasGroupConfig ? 'config' : 'keep'
    if (row.canRemoveDependency && row.installedByBundle === true) return 'dependency'
    if (row.hasGroupConfig) return 'config'
    return 'keep'
  }

  function ensureOverride() {
    return getPendingOverrides()
  }

  function getCleanupTargets(): BundleMemberCleanupTarget[] {
    return configCleanupMembers.value.map(member => ({
      package: member.package,
      plugin: member.plugin,
    }))
  }

  async function uninstallBundle() {
    const name = packageName.value
    if (!name || uninstalling.value) return
    const members = dependencyRemovalMembers.value.map(member => member.package)
    const configs = getCleanupTargets()
    const override = {
      [name]: '',
      ...Object.fromEntries(members.map(name => [name, ''])),
    }

    if (getBulkMode()) {
      const overrides = ensureOverride()
      Object.assign(overrides, override)
      void patchMarketNextData({ override: { ...overrides } })
      pendingBundleUninstalls.value[name] = {
        members,
        cleanup: !!configs.length,
        configs,
      }
      visible.value = false
      message.success(t('bundle.messages.stagedUninstall', { members: members.length, configs: configs.length }))
      return
    }

    visible.value = false
    uninstalling.value = true
    try {
      await install(override, async () => {
        if (configs.length) {
          await send('market/remove-bundle-configs', {
            package: name,
            members: configs,
            removeEmptyGroup: true,
          })
        }
        const records = getWritableBundleRecords()
        delete records[name]
        const saved = await patchMarketNextData({ bundleRecords: records })
        if (!saved) message.warning(t('bundle.messages.recordSaveFailed'))
        if (props.redirectToPlugins) await router.replace('/plugins')
        emit('done')
      }, undefined, {
        loadingText: t('bundle.messages.uninstalling'),
        successText: t('bundle.messages.uninstalled'),
        errorText: t('bundle.messages.uninstallFailed'),
        timeoutText: t('bundle.messages.uninstallTimeout'),
      })
    } finally {
      uninstalling.value = false
    }
  }

  return {
    modeClass,
    packageName,
    visible,
    recordView,
    memberRows,
    memberActions,
    loadingRecord,
    uninstalling,
    dependencyRemovalCount,
    configCleanupCount,
    keepCount,
    setAllActions,
    uninstallBundle,
  }
}
