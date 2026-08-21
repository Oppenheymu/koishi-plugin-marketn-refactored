<template>
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
</template>

<script lang="ts" setup>
import { message } from '@koishijs/client'
import type { InstallHistoryChange, InstallHistoryEntry, InstallLogDetail } from 'koishi-plugin-marketn-refactored'
import { useMarketNextI18n } from '../../i18n'

const props = defineProps<{
  detail?: InstallLogDetail
  detailLoading: boolean
  detailError: string
}>()

const { t, locale } = useMarketNextI18n()

async function copyLog() {
  const content = props.detail?.content
  if (!content) return
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = content
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
