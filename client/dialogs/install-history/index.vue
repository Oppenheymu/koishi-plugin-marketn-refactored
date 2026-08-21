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
              <span class="row-title">{{ historyTitle(t, entry) }}</span>
              <span class="row-packages">{{ historyPackages(entry) }}</span>
              <span class="row-meta">
                {{ historyDate(t, entry.startedAt, locale.value) }}
                <template v-if="entry.duration != null"> · {{ historyDuration(t, entry.duration) }}</template>
              </span>
            </span>
            <span :class="['status-label', entry.status]">{{ historyStatusText(t, entry.status) }}</span>
          </button>

          <div v-if="loading && !entries.length" class="history-state">{{ t('operations.history.reading') }}</div>
          <div v-else-if="loadError && !entries.length" class="history-state error">{{ loadError }}</div>
          <div v-else-if="!entries.length" class="history-state">{{ t('operations.history.empty') }}</div>
        </div>
      </aside>

      <install-history-detail
        :detail="detail"
        :detail-loading="detailLoading"
        :detail-error="detailError"
      />
    </div>

    <template #footer>
      <el-button @click="showInstallHistory = false">{{ t('operations.history.close') }}</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import type { InstallHistoryEntry, InstallLogDetail } from 'koishi-plugin-marketn-refactored'
import { getFrontendMode } from '../../shared/config/market-config'
import { showInstallHistory } from '../../shared/ui/dialogs'
import { useMarketNextI18n } from '../../i18n'
import { historyDate, historyDuration, historyStatusText, historyTitle } from './format'
import InstallHistoryDetail from './detail.vue'

const { t, locale } = useMarketNextI18n()
const modeClass = computed(() => `market-mode-${getFrontendMode()}`)
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

function historyPackages(entry: InstallHistoryEntry) {
  if (!entry.changes.length) return entry.deps
  return entry.changes.map(change => change.name).join(t('common.format.listSeparator'))
}

</script>

<style src="./index.scss" lang="scss"></style>
