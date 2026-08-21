<template>
  <div class="diff-list">
    <div class="diff-header">
      <span>{{ t('environment.dependency') }}</span>
      <span>{{ t('environment.currentVersion') }}</span>
      <span></span>
      <span>{{ t('environment.targetVersion') }}</span>
      <span>{{ t('environment.status') }}</span>
    </div>
    <div v-for="change in changes" :key="change.name" :class="['diff-row', change.status]">
      <strong :title="change.name">{{ change.name }}</strong>
      <span class="version-value" :title="versionText(change.currentVersion)">{{ versionText(change.currentVersion) }}</span>
      <span class="version-arrow">→</span>
      <span class="version-value target" :title="versionText(change.targetVersion)">{{ versionText(change.targetVersion) }}</span>
      <span :class="['change-status', change.status]">{{ statusText(change.status) }}</span>
      <small v-if="change.reason" class="change-reason">{{ reasonText(change.reason) }}</small>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { EnvironmentChangeStatus, EnvironmentSnapshotChange } from 'koishi-plugin-marketn-refactored'
import { useMarketNextI18n } from '../../i18n'

defineProps<{
  changes: EnvironmentSnapshotChange[]
}>()

const { t } = useMarketNextI18n()

function versionText(version?: string) {
  return version || t('environment.notInstalled')
}

function statusText(status: EnvironmentChangeStatus) {
  return t(`environment.change.${status}`)
}

function reasonText(reason: NonNullable<EnvironmentSnapshotChange['reason']>) {
  return t(`environment.reason.${reason}`)
}
</script>
