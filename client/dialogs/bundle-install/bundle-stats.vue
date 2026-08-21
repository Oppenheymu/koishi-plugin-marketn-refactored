<template>
  <div class="bundle-stats">
    <div class="bundle-stat">
      <span class="bundle-stat-num">{{ selectedMembers.length }}</span>
      <span class="bundle-stat-label">{{ t('bundle.stats.selected', { count: selectedMembers.length, total: members.length }) }}</span>
      <div class="bundle-stat-bar"><div class="bundle-stat-fill" :style="{ width: progressPercent + '%' }"></div></div>
    </div>
    <div class="bundle-stat">
      <span class="bundle-stat-num">{{ presetList.length }}</span>
      <span class="bundle-stat-label">{{ t('bundle.stats.presets') }}</span>
    </div>
    <div class="bundle-stat">
      <span class="bundle-stat-num">{{ moveList.length }}</span>
      <span class="bundle-stat-label">{{ t('bundle.stats.moved') }}</span>
    </div>
  </div>

  <k-comment v-if="validationErrors.length" type="danger">
    <p v-for="item in validationErrors" :key="item">{{ item }}</p>
  </k-comment>
  <k-comment v-if="validationWarnings.length" type="warning">
    <p v-for="item in validationWarnings" :key="item">{{ item }}</p>
  </k-comment>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useMarketNextI18n } from '../../i18n'
import { bundleContextKey } from './bundle-context'

const { t } = useMarketNextI18n()
const {
  members, selectedMembers, progressPercent, presetList, moveList,
  validationErrors, validationWarnings,
} = inject(bundleContextKey)!
</script>
