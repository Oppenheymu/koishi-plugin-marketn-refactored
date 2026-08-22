<template>
  <el-dialog
    v-model="showInstallHistory"
    append-to-body
    destroy-on-close
    :class="['install-history-dialog', modeClass]"
    :title="t('operations.history.title')"
    width="min(1040px, calc(100vw - 24px))"
  >
    <div class="history-toolbar">
      <span>{{ loading ? t('operations.history.syncing') : t('operations.history.count', { count: entries.length }) }}</span>
      <el-button :loading="loading" @click="loadHistory(true)">{{ t('operations.history.refresh') }}</el-button>
    </div>

    <div class="history-layout">
      <aside class="history-sidebar">
        <div class="list-heading">
          <span>{{ t('operations.history.records') }}</span>
          <span>{{ entries.length }}</span>
        </div>
        <div class="history-list" :class="{ loading }">
          <button
            v-for="entry in entries"
            :key="entry.id"
            type="button"
            :class="['history-row', { active: entry.id === selectedId }]"
            @click="selectEntry(entry.id)"
          >
            <span :class="['status-dot', entry.status]"></span>
            <span class="row-main">
              <span class="row-title">{{ historyTitle(entry) }}</span>
              <span class="row-packages">{{ historyPackages(entry) }}</span>
              <span class="row-meta">
                {{ formatDate(entry.startedAt) }}
                <template v-if="entry.duration != null"> · {{ formatDuration(entry.duration) }}</template>
              </span>
            </span>
            <span :class="['status-label', entry.status]">{{ statusText(entry.status) }}</span>
          </button>

          <div v-if="loading && !entries.length" class="history-state">{{ t('operations.history.reading') }}</div>
          <div v-else-if="loadError && !entries.length" class="history-state error">{{ loadError }}</div>
          <div v-else-if="!entries.length" class="history-state">{{ t('operations.history.empty') }}</div>
        </div>
      </aside>

      <section class="history-detail">
        <div v-if="detailLoading" class="history-state">{{ t('operations.history.readingLog') }}</div>
        <div v-else-if="detailError" class="history-state error">{{ detailError }}</div>
        <template v-else-if="detail">
          <header class="detail-header">
            <div class="detail-title">
              <div class="detail-status">
                <span :class="['status-dot', detail.status]"></span>
                <span :class="['status-label', detail.status]">{{ statusText(detail.status) }}</span>
              </div>
              <h3>{{ historyTitle(detail) }}</h3>
              <p>
                {{ formatDate(detail.startedAt) }}
                <template v-if="detail.duration != null"> · {{ formatDuration(detail.duration) }}</template>
              </p>
            </div>
            <div class="detail-actions">
              <el-button size="small" @click="copyLog">{{ t('operations.history.copyLog') }}</el-button>
            </div>
          </header>

          <dl class="detail-meta">
            <div><dt>{{ t('operations.history.dependencyCount') }}</dt><dd>{{ detail.changes.length || t('operations.history.unknown') }}</dd></div>
            <div><dt>{{ t('operations.history.source') }}</dt><dd :title="detail.installEndpoint">{{ formatEndpoint(detail.installEndpoint) }}</dd></div>
            <div><dt>{{ t('operations.history.logSize') }}</dt><dd>{{ formatSize(detail.size) }}</dd></div>
          </dl>

          <section v-if="detail.changes.length" class="versions-section">
            <div class="section-heading">
              <span>{{ t('operations.history.versionChanges') }}</span>
              <span>{{ t('operations.history.items', { count: detail.changes.length }) }}</span>
            </div>
            <div class="change-list">
              <div v-for="change in detail.changes" :key="change.name" class="change-row">
                <strong :title="change.name">{{ change.name }}</strong>
                <span class="version-value" :title="beforeVersion(change)">
                  <span class="version-text">{{ beforeVersion(change) }}</span>
                </span>
                <span class="version-arrow">→</span>
                <span class="version-value after" :title="afterVersion(change)">
                  <span class="version-text">{{ afterVersion(change) }}</span>
                </span>
              </div>
            </div>
          </section>

          <p v-if="detail.truncated" class="truncated-note">{{ t('operations.history.truncated') }}</p>
        </template>
        <div v-else class="history-state">{{ t('operations.history.selectRecord') }}</div>
      </section>
    </div>

    <template #footer>
      <el-button @click="showInstallHistory = false">{{ t('operations.history.close') }}</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { message, send, useConfig } from '@koishijs/client'
import type { InstallHistoryChange, InstallHistoryEntry, InstallLogDetail } from 'koishi-plugin-marketn-refactored'
import { getFrontendMode } from '../shared/plugin-config'
import { showInstallHistory } from '../shared/operations'
import { useMarketNextI18n } from '../shared/i18n'

const config = useConfig()
const { t, locale } = useMarketNextI18n()
const modeClass = computed(() => `market-mode-${getFrontendMode(config.value)}`)
const entries = ref<InstallHistoryEntry[]>([])
const selectedId = ref('')
const detail = ref<InstallLogDetail>()
const loading = ref(false)
const detailLoading = ref(false)
const loadError = ref('')
const detailError = ref('')
let detailSerial = 0

watch(showInstallHistory, (visible) => {
  if (visible) void loadHistory()
})

async function loadHistory(preserveSelection = false) {
  if (loading.value) return
  loading.value = true
  loadError.value = ''
  try {
    const result = await (send('market/install-history', 20) ?? Promise.resolve([]))
    entries.value = result ?? []
    const target = preserveSelection && entries.value.some(entry => entry.id === selectedId.value)
      ? selectedId.value
      : entries.value[0]?.id || ''
    if (target) {
      await selectEntry(target, true)
    } else {
      selectedId.value = ''
      detail.value = undefined
    }
  } catch (error) {
    console.error(error)
    loadError.value = t('operations.history.loadFailed')
  } finally {
    loading.value = false
  }
}

async function selectEntry(id: string, force = false) {
  if (!force && id === selectedId.value && detail.value) return
  selectedId.value = id
  detail.value = undefined
  detailError.value = ''
  detailLoading.value = true
  const serial = ++detailSerial
  try {
    const result = await (send('market/install-history-detail', id) ?? Promise.resolve(undefined))
    if (serial !== detailSerial) return
    if (!result) throw new Error('install log not found')
    detail.value = result
  } catch (error) {
    if (serial !== detailSerial) return
    console.error(error)
    detailError.value = t('operations.history.detailFailed')
  } finally {
    if (serial === detailSerial) detailLoading.value = false
  }
}

async function copyLog() {
  if (!detail.value?.content) return
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(detail.value.content)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = detail.value.content
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    message.success(t('operations.history.copied'))
  } catch (error) {
    console.error(error)
    message.error(t('operations.history.copyFailed'))
  }
}

function statusText(status: InstallHistoryEntry['status']) {
  switch (status) {
    case 'running': return t('operations.history.statusRunning')
    case 'success': return t('operations.history.statusSuccess')
    case 'error': return t('operations.history.statusError')
    default: return t('operations.history.statusUnknown')
  }
}

function historyTitle(entry: InstallHistoryEntry) {
  if (!entry.changes.length) return t('operations.history.operation')
  let installed = 0
  let removed = 0
  let updated = 0
  for (const change of entry.changes) {
    if (!change.beforeRequest && change.afterRequest) installed++
    else if (change.beforeRequest && !change.afterRequest) removed++
    else updated++
  }
  const groups = [
    installed && t('operations.history.install', { count: installed }),
    updated && t('operations.history.update', { count: updated }),
    removed && t('operations.history.uninstall', { count: removed }),
  ].filter(Boolean)
  if (groups.length === 1) return groups[0]
  return t('operations.history.changed', { count: entry.changes.length })
}

function historyPackages(entry: InstallHistoryEntry) {
  if (!entry.changes.length) return entry.deps
  return entry.changes.map(change => change.name).join(t('common.format.listSeparator'))
}

function beforeVersion(change: InstallHistoryChange) {
  return change.beforeResolved || change.beforeRequest || t('operations.history.notInstalled')
}

function afterVersion(change: InstallHistoryChange) {
  return change.afterResolved || change.afterRequest || t('operations.history.uninstalled')
}

function formatDate(value: number) {
  if (!Number.isFinite(value) || value <= 0) return t('operations.history.unknownTime')
  return new Date(value).toLocaleString(locale.value)
}

function formatDuration(value: number) {
  if (value < 1000) return `${Math.max(0, Math.round(value))} ms`
  if (value < 60000) return t('common.time.seconds', { count: (value / 1000).toFixed(value < 10000 ? 1 : 0) })
  const minutes = Math.floor(value / 60000)
  const seconds = Math.round(value % 60000 / 1000)
  return t('common.time.minutesSeconds', { minutes, seconds })
}

function formatEndpoint(endpoint?: string) {
  if (!endpoint) return t('operations.history.defaultSource')
  try {
    return new URL(endpoint).host
  } catch {
    return endpoint
  }
}

function formatSize(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
</script>

<style lang="scss" src="./install-history.scss"></style>
