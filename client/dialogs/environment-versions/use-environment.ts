import { computed, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import type {
  EnvironmentChangeStatus,
  EnvironmentSnapshotPreview,
  EnvironmentSnapshotSource,
  EnvironmentSnapshotSummary,
} from 'koishi-plugin-marketn-refactored'
import { getFrontendMode } from '../../shared/config/market-config'
import { applyEnvironmentSnapshot } from '../../shared/install/environment-flow'
import { showEnvironmentVersions } from '../../shared/ui/dialogs'
import { useMarketNextI18n } from '../../i18n'

export function useEnvironment() {
  const { t, locale } = useMarketNextI18n()
  const modeClass = computed(() => `market-mode-${getFrontendMode()}`)
  const snapshots = ref<EnvironmentSnapshotSummary[]>([])
  const selectedId = ref('')
  const preview = ref<EnvironmentSnapshotPreview>()
  const loading = ref(false)
  const previewLoading = ref(false)
  const loadError = ref('')
  const previewError = ref('')
  const confirmVisible = ref(false)
  let previewSerial = 0

  watch(showEnvironmentVersions, (visible) => {
    if (visible) void loadSnapshots()
    else confirmVisible.value = false
  })

  const statusOrder: Record<EnvironmentChangeStatus, number> = {
    unsupported: 0,
    removed: 1,
    downgrade: 2,
    upgrade: 3,
    added: 4,
    changed: 5,
    unchanged: 6,
  }

  const orderedChanges = computed(() => [...(preview.value?.changes ?? [])].sort((left, right) => {
    return statusOrder[left.status] - statusOrder[right.status] || left.name.localeCompare(right.name)
  }))

  const changedCount = computed(() => preview.value?.changes.filter(change => change.status !== 'unchanged').length ?? 0)
  const unchangedCount = computed(() => preview.value?.changes.filter(change => change.status === 'unchanged').length ?? 0)
  const removedCount = computed(() => preview.value?.changes.filter(change => change.status === 'removed').length ?? 0)
  const canApply = computed(() => !!preview.value
    && !preview.value.snapshot.current
    && preview.value.actionableCount > 0
    && preview.value.unsupportedCount === 0)

  async function loadSnapshots(preserveSelection = false) {
    if (loading.value) return
    loading.value = true
    loadError.value = ''
    try {
      snapshots.value = await (send('market/environment-snapshots') ?? Promise.resolve([]))
      const previous = preserveSelection && snapshots.value.some(snapshot => snapshot.id === selectedId.value)
        ? selectedId.value
        : ''
      const target = previous || snapshots.value.find(snapshot => !snapshot.current)?.id || snapshots.value[0]?.id || ''
      if (target) await selectSnapshot(target, true)
      else {
        selectedId.value = ''
        preview.value = undefined
      }
    } catch (error) {
      console.error(error)
      loadError.value = t('environment.loadFailed')
    } finally {
      loading.value = false
    }
  }

  async function selectSnapshot(id: string, force = false) {
    if (!force && id === selectedId.value && preview.value) return
    selectedId.value = id
    preview.value = undefined
    previewError.value = ''
    previewLoading.value = true
    const serial = ++previewSerial
    try {
      const result = await (send('market/environment-snapshot-preview', id) ?? Promise.resolve(undefined))
      if (serial !== previewSerial) return
      if (!result) throw new Error('environment snapshot not found')
      preview.value = result
    } catch (error) {
      if (serial !== previewSerial) return
      console.error(error)
      previewError.value = t('environment.previewFailed')
    } finally {
      if (serial === previewSerial) previewLoading.value = false
    }
  }

  function applySnapshot() {
    if (!canApply.value || !preview.value) return
    const id = preview.value.snapshot.id
    const selfUpdate = preview.value.changes.some(change => {
      return change.name === 'koishi-plugin-marketn-refactored' && change.status !== 'unchanged'
    })
    confirmVisible.value = false
    void applyEnvironmentSnapshot(id, selfUpdate)
  }

  function formatDate(value: number) {
    if (!Number.isFinite(value) || value <= 0) return t('common.messages.timeUnknown')
    return new Date(value).toLocaleString(locale.value)
  }

  function sourceText(source: EnvironmentSnapshotSource) {
    switch (source) {
      case 'startup': return t('environment.sourceStartup')
      case 'operation': return t('environment.sourceOperation')
      default: return t('environment.sourceExternal')
    }
  }

  return {
    t,
    locale,
    modeClass,
    snapshots,
    selectedId,
    preview,
    loading,
    previewLoading,
    loadError,
    previewError,
    confirmVisible,
    orderedChanges,
    changedCount,
    unchangedCount,
    removedCount,
    canApply,
    loadSnapshots,
    selectSnapshot,
    applySnapshot,
    formatDate,
    sourceText,
  }
}
