<template>
  <div class="bundle-bulk-row">
    <span class="bulk-label">{{ t('bundle.bulk.label') }}</span>
    <button class="bundle-section-action" @click="batchSetCreateConfig(true)">{{ t('bundle.bulk.createAll') }}</button>
    <span class="bundle-section-spacer">|</span>
    <button class="bundle-section-action" @click="batchSetCreateConfig(false)">{{ t('bundle.bulk.skipAll') }}</button>
    <template v-if="selectedMembers.some(m => hasPreset(m))">
      <span class="bundle-section-spacer">|</span>
      <button class="bundle-section-action" @click="batchSetUsePreset(true)">{{ t('bundle.bulk.enablePresets') }}</button>
      <span class="bundle-section-spacer">|</span>
      <button class="bundle-section-action" @click="batchSetUsePreset(false)">{{ t('bundle.bulk.disablePresets') }}</button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useMarketNextI18n } from '../../../i18n'
  import { bundleContextKey } from '../logic/bundle-context'

const { t } = useMarketNextI18n()
const { selectedMembers, hasPreset, batchSetCreateConfig, batchSetUsePreset } = inject(bundleContextKey)!
</script>
