<template>
  <el-dialog
    v-model="installProgressState.visible"
    append-to-body
    :show-close="installProgressState.status !== 'running'"
    :before-close="handleBeforeClose"
    :class="['install-progress-dialog', modeClass]"
    :title="installProgressState.title"
    width="min(800px, calc(100vw - 24px))"
  >
    <div class="progress-body">
      <!-- Status Banner -->
      <div :class="['status-banner', installProgressState.status]">
        <div class="status-indicator">
          <span v-if="installProgressState.status === 'running'" class="pulse-dot"></span>
          <market-icon v-else-if="installProgressState.status === 'success'" name="verified"></market-icon>
          <span v-else-if="installProgressState.status === 'error'" class="error-cross">×</span>
          <span>{{ statusText }}</span>
        </div>
      </div>

      <!-- Log Terminal -->
      <div class="terminal-container">
        <div class="terminal-header">
          <span class="term-title">{{ t('operations.progress.logTitle') }}</span>
        </div>
        <div class="terminal-viewport" ref="viewport">
          <div class="terminal-content">
            <template v-if="installProgressState.logs.length">
              <div
                v-for="(log, index) in installProgressState.logs"
                :key="index"
                :class="['log-line', log.type]"
              >
                <span class="line-prefix">$</span>
                <span class="line-text">{{ log.line }}</span>
              </div>
            </template>
            <div v-else class="empty-logs">
              <span class="loading-spinner"></span>
              {{ t('operations.progress.initializing') }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <div v-if="installProgressState.fallbackCandidate" class="fallback-prompt">
          {{ t('operations.progress.fallbackPrefix') }}
          <strong>{{ installProgressState.fallbackCandidate.label }}</strong>
          {{ t('operations.progress.fallbackSuffix') }}
        </div>
        <el-button
          v-if="installProgressState.fallbackCandidate && installProgressState.retryFallback"
          type="primary"
          :loading="installProgressState.fallbackRunning"
          :disabled="installProgressState.fallbackRunning"
          @click="retryFallback"
        >
          {{ t('operations.progress.retryFallback') }}
        </el-button>
        <el-button
          :type="installProgressState.status === 'error' ? 'danger' : 'primary'"
          :disabled="installProgressState.status === 'running'"
          @click="close"
        >
          {{ installProgressState.status === 'running' ? t('operations.progress.executing') : t('operations.progress.close') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import { computed, nextTick, ref, watch } from 'vue'
import { getFrontendMode } from '../lib/market-config'
import { installProgressState } from '../lib/install-flow'
import { useMarketNextI18n } from '../i18n'
import MarketIcon from '../market/icons'

const { t } = useMarketNextI18n()
const frontendMode = computed(() => getFrontendMode())
const modeClass = computed(() => `market-mode-${frontendMode.value}`)

const viewport = ref<HTMLElement>()

const statusText = computed(() => {
  if (installProgressState.environmentRestore) {
    switch (installProgressState.status) {
      case 'running': return t('operations.progress.runningEnvironment')
      case 'success': return t('operations.progress.successEnvironment')
      case 'error': return t('operations.progress.errorEnvironment')
      default: return t('operations.progress.ready')
    }
  }
  const selfUpdateText = installProgressState.selfUpdate
  switch (installProgressState.status) {
    case 'running': return selfUpdateText
      ? t('operations.progress.runningSelf')
      : t('operations.progress.runningDependencies')
    case 'success': return selfUpdateText
      ? t('operations.progress.successSelf')
      : t('operations.progress.successDependencies')
    case 'error': return selfUpdateText
      ? t('operations.progress.errorSelf')
      : t('operations.progress.errorDependencies')
    default: return t('operations.progress.ready')
  }
})

// Auto-scroll logs to bottom
watch(() => installProgressState.logs.length, () => {
  nextTick(() => {
    if (!viewport.value) return
    viewport.value.scrollTop = viewport.value.scrollHeight
  })
})

function handleBeforeClose(done: () => void) {
  if (installProgressState.status !== 'running') {
    done()
  }
}

function close() {
  installProgressState.visible = false
}

function retryFallback() {
  void installProgressState.retryFallback?.()
}
</script>

<style src="./install-progress.scss" lang="scss"></style>
