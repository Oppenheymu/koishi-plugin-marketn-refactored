import { computed, reactive, ref, watch } from 'vue'
import { useContext } from '@koishijs/client'
import type { Registry } from '@koishijs/registry'
import {
  type BundleInstallMember,
  type BundleInstallRequest,
  type PluginBundleManifest,
  hasBundleKeyword,
  validateBundleManifest,
} from '../../../../src/shared/bundle'
import { activeBundle } from '../../../shared/ui/dialogs'
import { resetInstallFallbackState, type InstallOptions, installProgressState } from '../../../shared/install/install-flow'
import { useMarketNextI18n } from '../../../i18n'
import { useMarketModeClass } from '../../../shared/ui/market-mode'
  import { useMemberInfo } from './member-info'
  import { createBundleLoader } from './load-bundle'
  import { runBundleInstall } from './bundle-install-runner'
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

  const { loadBundle } = createBundleLoader({
    ctx,
    t,
    loading,
    error,
    registry,
    bundle,
    resolvedBundleVersion,
    members,
    memberJsonErrors,
  })

  watch(activeBundle, (value) => {
    void loadBundle(value)
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

    const request: BundleInstallRequest = {
      package: activeBundle.value!.package.name,
      version: bundleVersion.value,
      bundle: bundle.value!,
      members: members.map(member => ({
        ...member,
        createConfig: member.createConfig || !!member.move,
      })),
    }

    try {
      await runBundleInstall(t, request, undefined, installing)
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
