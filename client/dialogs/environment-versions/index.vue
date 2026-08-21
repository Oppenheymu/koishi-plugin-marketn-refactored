<template>
  <el-dialog
    v-model="showEnvironmentVersions"
    append-to-body
    destroy-on-close
    :class="['environment-versions-dialog', modeClass]"
    :title="t('environment.title')"
    width="min(1080px, calc(100vw - 24px))"
  >
    <div class="environment-toolbar">
      <span>{{ loading ? t('environment.syncing') : t('environment.count', { count: snapshots.length }) }}</span>
      <el-button :loading="loading" @click="loadSnapshots(true)">{{ t('environment.refresh') }}</el-button>
    </div>

    <div class="environment-layout">
      <aside class="snapshot-sidebar">
        <div class="snapshot-heading">
          <span>{{ t('environment.snapshots') }}</span>
          <span>{{ snapshots.length }}</span>
        </div>
        <div class="snapshot-list">
          <button
            v-for="snapshot in snapshots"
            :key="snapshot.id"
            type="button"
            :class="['snapshot-row', { active: snapshot.id === selectedId, current: snapshot.current }]"
            @click="selectSnapshot(snapshot.id)"
          >
            <span class="snapshot-icon">
              <market-icon :name="snapshot.current ? 'verified' : 'file-archive'"></market-icon>
            </span>
            <span class="snapshot-main">
              <strong>{{ snapshot.current ? t('environment.currentEnvironment') : t('environment.savedEnvironment') }}</strong>
              <span>{{ formatDate(snapshot.createdAt) }}</span>
              <small>{{ sourceText(snapshot.source) }} · {{ t('environment.dependencies', { count: snapshot.dependencyCount }) }}</small>
            </span>
            <span v-if="snapshot.current" class="current-pill">{{ t('environment.current') }}</span>
          </button>

          <div v-if="loading && !snapshots.length" class="environment-state">{{ t('environment.reading') }}</div>
          <div v-else-if="loadError && !snapshots.length" class="environment-state error">{{ loadError }}</div>
          <div v-else-if="!snapshots.length" class="environment-state">{{ t('environment.empty') }}</div>
        </div>
      </aside>

      <section class="snapshot-detail">
        <div v-if="previewLoading" class="environment-state">{{ t('environment.readingPreview') }}</div>
        <div v-else-if="previewError" class="environment-state error">{{ previewError }}</div>
        <template v-else-if="preview">
          <header class="preview-header">
            <div>
              <span class="preview-eyebrow">{{ t('environment.targetEnvironment') }}</span>
              <h3>{{ preview.snapshot.current ? t('environment.currentEnvironment') : formatDate(preview.snapshot.createdAt) }}</h3>
              <p>{{ sourceText(preview.snapshot.source) }} · {{ t('environment.dependencies', { count: preview.snapshot.dependencyCount }) }}</p>
            </div>
            <div class="preview-summary">
              <span class="changed">{{ t('environment.changedCount', { count: changedCount }) }}</span>
              <span>{{ t('environment.unchangedCount', { count: unchangedCount }) }}</span>
              <span v-if="preview.unsupportedCount" class="blocked">{{ t('environment.unsupportedCount', { count: preview.unsupportedCount }) }}</span>
            </div>
          </header>

          <k-comment type="warning" class="scope-warning">
            {{ t('environment.scopeWarning') }}
          </k-comment>

          <diff-list :changes="orderedChanges" />
        </template>
        <div v-else class="environment-state">{{ t('environment.selectSnapshot') }}</div>
      </section>
    </div>

    <template #footer>
      <el-button @click="showEnvironmentVersions = false">{{ t('common.actions.close') }}</el-button>
      <el-button type="primary" :disabled="!canApply" @click="confirmVisible = true">
        {{ preview?.snapshot.current ? t('environment.alreadyCurrent') : t('environment.restore') }}
      </el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="confirmVisible"
    append-to-body
    :class="['environment-confirm-dialog', modeClass]"
    :title="t('environment.confirmTitle')"
    width="min(520px, calc(100vw - 24px))"
  >
    <p>{{ t('environment.confirmText', { count: preview?.actionableCount ?? 0 }) }}</p>
    <k-comment type="warning">{{ t('environment.scopeWarning') }}</k-comment>
    <k-comment v-if="removedCount" type="danger">
      {{ t('environment.removeWarning', { count: removedCount }) }}
    </k-comment>
    <template #footer>
      <el-button @click="confirmVisible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" @click="applySnapshot">{{ t('environment.confirmRestore') }}</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import type {
  EnvironmentChangeStatus,
  EnvironmentSnapshotPreview,
  EnvironmentSnapshotSource,
  EnvironmentSnapshotSummary,
} from 'koishi-plugin-marketn-refactored'
import { getFrontendMode } from '../../shared/config/market-config'
import { applyEnvironmentSnapshot } from '../../shared/install/install-flow'
import { showEnvironmentVersions } from '../../shared/ui/dialogs'
import { useMarketNextI18n } from '../../i18n'
import MarketIcon from '../../market/icons'
import DiffList from './diff-list.vue'

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
</script>

<style src="./index.scss" lang="scss"></style>
