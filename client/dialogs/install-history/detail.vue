<template>
  <section class="history-detail">
    <div v-if="detailLoading" class="history-state">{{ t('operations.history.readingLog') }}</div>
    <div v-else-if="detailError" class="history-state error">{{ detailError }}</div>
    <template v-else-if="detail">
      <header class="detail-header">
        <div class="detail-title">
          <div class="detail-status">
            <span :class="['status-dot', detail.status]"></span>
            <span :class="['status-label', detail.status]">{{ historyStatusText(t, detail.status) }}</span>
          </div>
          <h3>{{ historyTitle(t, detail) }}</h3>
          <p>
            {{ historyDate(t, detail.startedAt, locale.value) }}
            <template v-if="detail.duration != null"> · {{ historyDuration(t, detail.duration) }}</template>
          </p>
        </div>
        <div class="detail-actions">
          <el-button size="small" @click="copyLog">{{ t('operations.history.copyLog') }}</el-button>
        </div>
      </header>

      <dl class="detail-meta">
        <div><dt>{{ t('operations.history.dependencyCount') }}</dt><dd>{{ detail.changes.length || t('operations.history.unknown') }}</dd></div>
        <div><dt>{{ t('operations.history.source') }}</dt><dd :title="detail.installEndpoint">{{ historyEndpoint(t, detail.installEndpoint) }}</dd></div>
        <div><dt>{{ t('operations.history.logSize') }}</dt><dd>{{ historySize(detail.size) }}</dd></div>
      </dl>

      <section v-if="detail.changes.length" class="versions-section">
        <div class="section-heading">
          <span>{{ t('operations.history.versionChanges') }}</span>
          <span>{{ t('operations.history.items', { count: detail.changes.length }) }}</span>
        </div>
        <div class="change-list">
          <div v-for="change in detail.changes" :key="change.name" class="change-row">
            <strong :title="change.name">{{ change.name }}</strong>
            <span class="version-value" :title="beforeVersion(t, change)">
              <span class="version-text">{{ beforeVersion(t, change) }}</span>
            </span>
            <span class="version-arrow">→</span>
            <span class="version-value after" :title="afterVersion(t, change)">
              <span class="version-text">{{ afterVersion(t, change) }}</span>
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
import type { InstallLogDetail } from 'koishi-plugin-marketn-refactored'
import { useMarketNextI18n } from '../../i18n'
import { afterVersion, beforeVersion, historyDate, historyDuration, historyEndpoint, historySize, historyStatusText, historyTitle } from './format'

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

</script>
