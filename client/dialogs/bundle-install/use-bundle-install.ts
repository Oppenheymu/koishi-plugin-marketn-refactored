import { computed, reactive, ref, watch } from 'vue'
import { message, send, socket, store, useContext } from '@koishijs/client'
import type { Registry } from '@koishijs/registry'
import {
  type BundleInstallMember,
  type BundleInstallResult,
  type PluginBundleManifest,
  getBundleGroupIdent,
  hasBundleKeyword,
  parseBundleManifest,
  scanSensitiveConfig,
  validateBundleManifest,
} from '../../../src/shared/bundle'
import { activeBundle } from '../../shared/ui/dialogs'
import { getBundleMemberConfigState } from '../../shared/install/bundle-records'
import { installProgressState, prepareInstallFallbackRetry, resetInstallFallbackState, type InstallOptions } from '../../shared/install/install-flow'
import { satisfies } from 'semver'
import { useMarketNextI18n } from '../../i18n'
import { useMarketModeClass } from '../../shared/ui/market-mode'
import { loadMarketObjects } from '../../market/state'
import { useMemberInfo } from './member-info'
import { formatInstallError, formatShortname, memberCategory, reportInstallError } from './helpers'

export function useBundleInstall() {
  const loading = ref(false)
  const installing = ref(false)
  const error = ref('')
  const registry = ref<Registry>()
  const bundle = ref<PluginBundleManifest>()
  const resolvedBundleVersion = ref('')
  const members = reactive<BundleInstallMember[]>([])
  const ctx = useContext()
  const { t, locale } = useMarketNextI18n()
  const memberInfoHelpers = useMemberInfo({ t, locale })

  const { modeClass } = useMarketModeClass()

  const title = computed(() => activeBundle.value?.shortname || activeBundle.value?.package.name || t('bundle.label'))
  const bundleVersion = computed(() => resolvedBundleVersion.value || activeBundle.value?.package.version || '')
  const validation = computed(() => {
    if (!activeBundle.value || !bundle.value) return { valid: false, errors: [], warnings: [] }
    return validateBundleManifest(activeBundle.value.package.name, bundle.value, {
      keyword: hasBundleKeyword(activeBundle.value.package.keywords),
    })
  })
  const validationErrors = computed(() => validation.value.errors)
  const validationWarnings = computed(() => validation.value.warnings)
  const selectedMembers = computed(() => members.filter(member => member.selected))
  const requiredMembers = computed(() => members.filter(m => m.required))
  const optionalMembers = computed(() => members.filter(m => !m.required))
  const progressPercent = computed(() => members.length ? Math.round(selectedMembers.value.length / members.length * 100) : 0)
  const allOptionalSelected = computed(() => optionalMembers.value.length > 0 && optionalMembers.value.every(m => m.selected))

  function toggleAllOptional() {
    const target = !allOptionalSelected.value
    for (const m of optionalMembers.value) m.selected = target
  }

  const installList = computed(() => {
    if (!activeBundle.value) return []
    return [
      `${activeBundle.value.package.name}@${bundleVersion.value}`,
      ...selectedMembers.value.map(member => `${member.package}@${member.version}`),
    ]
  })
  const configList = computed(() => selectedMembers.value
    .filter(member => member.createConfig && !member.move)
    .map(member => member.plugin))
  const moveList = computed(() => selectedMembers.value
    .filter(member => member.move)
    .map(member => member.plugin))
  const presetList = computed(() => selectedMembers.value
    .filter(member => member.createConfig && member.usePreset && !member.move)
    .map(member => member.plugin))
  const skippedConfigList = computed(() => selectedMembers.value
    .filter(member => !member.createConfig && !member.move)
    .map(member => member.plugin))

  const memberJsonErrors = reactive<Record<string, string>>({})

  function getMemberKey(member: BundleInstallMember) {
    return `${member.package}:${member.plugin}`
  }

  function onJsonInput(member: BundleInstallMember, value: string) {
    const key = getMemberKey(member)
    try {
      const parsed = JSON.parse(value)
      member.config = parsed
      delete memberJsonErrors[key]
    } catch (err) {
      memberJsonErrors[key] = (err as Error).message
    }
  }

  const canInstall = computed(() => {
    return !!activeBundle.value 
      && !!bundle.value 
      && validation.value.valid 
      && selectedMembers.value.length > 0 
      && !loading.value
      && Object.keys(memberJsonErrors).length === 0
  })

  watch(activeBundle, async (value) => {
    error.value = ''
    registry.value = undefined
    bundle.value = undefined
    resolvedBundleVersion.value = ''
    members.splice(0)
    Object.keys(memberJsonErrors).forEach(key => delete memberJsonErrors[key])
    if (!value) return
    loading.value = true
    try {
      const data = await send('market/package', value.package.name) as Registry
      if (!data?.versions) {
        error.value = t('bundle.messages.noMetadata')
        return
      }
      registry.value = data
      const remoteEntry = data.versions?.[value.package.version]
        ? [value.package.version, data.versions[value.package.version]] as const
        : Object.entries(data.versions ?? {})[0]
      if (!remoteEntry) {
        error.value = t('bundle.messages.noMetadata')
        return
      }
      const [remoteVersion, remote] = remoteEntry
      const parsed = parseBundleManifest((remote as any)?.koishi?.bundle)
      if (!parsed) {
        error.value = t('bundle.messages.noManifest')
        return
      }
      resolvedBundleVersion.value = remoteVersion
      bundle.value = parsed
      void loadMarketObjects(parsed.members.map(member => member.package)).catch(error => {
        console.error('[market-next] failed to load bundle member metadata', error)
      })
      const groupKey = `group:${getBundleGroupIdent(value.package.name)}`
      for (const member of parsed.members) {
        const state = getBundleMemberConfigState(ctx, member, groupKey)
        const hasConfig = !!(state.group.length || state.external.length)
        const conflictType = state.group.length ? 'same-group' : state.external.length ? 'other-config' : undefined
        
        const dep = store.dependencies?.[member.package]
        const isMismatch = dep?.resolved && !satisfies(dep.resolved, member.version, { includePrerelease: true })
        
        members.push({
          ...member,
          selected: !!member.required || (!!dep && !isMismatch),
          createConfig: !hasConfig && conflictType !== 'same-group',
          usePreset: !hasConfig && !!member.config && Object.keys(member.config).length > 0,
          move: false,
          conflict: (conflictType || (isMismatch ? 'package-mismatch' : undefined))!,
        })
      }
      const names = parsed.members.map(member => member.package).filter(name => !store.registry?.[name])
      if (names.length) {
        const result = await (send('market/registry', names) ?? Promise.resolve(undefined)).catch(() => undefined)
        if (result) store.registry = { ...store.registry, ...result }
      }
    } catch (err) {
      console.error(err)
      error.value = err instanceof Error ? err.message : t('bundle.messages.loadFailed')
    } finally {
      loading.value = false
    }
  }, { immediate: true })

  const {
    memberInfo,
    getPackageDescription,
    getInstalledText,
    versionMeta,
    riskTags,
    hasPreset,
    sensitiveFields,
    formatConfig,
  } = memberInfoHelpers

  function toggleMember(member: BundleInstallMember) {
    member.selected = !member.selected
  }

  function close() {
    if (installing.value) return
    activeBundle.value = undefined
  }

  function batchSetCreateConfig(value: boolean) {
    for (const m of selectedMembers.value) {
      if (m.conflict !== 'same-group') {
        m.createConfig = value
        if (!value) {
          m.usePreset = false
        }
      }
    }
  }

  function batchSetUsePreset(value: boolean) {
    for (const m of selectedMembers.value) {
      if (hasPreset(m) && m.createConfig && !m.move) {
        m.usePreset = value
      }
    }
  }

  async function confirmInstall() {
    if (!activeBundle.value || !bundle.value || installing.value) return
    installing.value = true

    installProgressState.title = t('bundle.messages.installing')
    installProgressState.logs = []
    installProgressState.status = 'running'
    installProgressState.visible = true
    installProgressState.selfUpdate = false
    installProgressState.environmentRestore = false
    resetInstallFallbackState()
    installProgressState.logs.push({
      type: 'stdout',
      line: t('bundle.messages.submitted'),
    })

    const request = {
      package: activeBundle.value!.package.name,
      version: bundleVersion.value,
      bundle: bundle.value!,
      members: members.map(member => ({
        ...member,
        createConfig: member.createConfig || !!member.move,
      })),
    }

    const runInstall = async (options?: InstallOptions) => {
      installing.value = true
      let disconnectedBeforeResponse = false
      let resolveDisconnected: (value: undefined) => void
      const disconnected = new Promise<undefined>((resolve) => {
        resolveDisconnected = resolve
      })
      const dispose = watch(socket, (value, previous) => {
        if (value || !previous) return
        disconnectedBeforeResponse = true
        resolveDisconnected(undefined)
        dispose()
      })
      const waitTimer = setTimeout(() => {
        if (installProgressState.status !== 'running') return
        installProgressState.logs.push({
          type: 'stdout',
          line: t('bundle.messages.waiting'),
        })
      }, 8000)
      try {
        const task = send('market/install-bundle', request, undefined, options ?? {}) as Promise<BundleInstallResult> | undefined
        const result = await Promise.race([task ?? Promise.resolve(undefined), disconnected])
        if (disconnectedBeforeResponse) {
          installProgressState.status = 'error'
          reportInstallError(t, t('bundle.messages.disconnected'))
          return undefined
        }
        if (result?.code) {
          installProgressState.status = 'error'
          reportInstallError(t, t('bundle.messages.exitCode', { code: result.code }))
          await prepareInstallFallbackRetry(runInstall, options?.installEndpoint)
          return result.code
        }
        installProgressState.status = 'success'
        const moved = result?.moved?.length ? t('bundle.messages.moved', { count: result.moved.length }) : ''
        const skipped = result?.skipped?.length ? t('bundle.messages.skipped', { count: result.skipped.length }) : ''
        message.success(t('bundle.messages.completed', { moved, skipped }))
        activeBundle.value = undefined
        return 0
      } finally {
        clearTimeout(waitTimer)
        dispose()
        installing.value = false
      }
    }

    try {
      await runInstall()
    } catch (err) {
      console.error(err)
      installProgressState.status = 'error'
      reportInstallError(t, formatInstallError(t, err))
    }
  }

  return {
    t,
    activeBundle,
    modeClass,
    title,
    bundleVersion,
    validationErrors,
    validationWarnings,
    loading,
    installing,
    error,
    bundle,
    members,
    selectedMembers,
    requiredMembers,
    optionalMembers,
    progressPercent,
    allOptionalSelected,
    presetList,
    moveList,
    installList,
    configList,
    skippedConfigList,
    memberJsonErrors,
    memberCategory,
    formatShortname,
    riskTags,
    getInstalledText,
    getPackageDescription,
    hasPreset,
    sensitiveFields,
    formatConfig,
    onJsonInput,
    getMemberKey,
    toggleMember,
    toggleAllOptional,
    batchSetCreateConfig,
    batchSetUsePreset,
    close,
    confirmInstall,
    canInstall,
  }
}
