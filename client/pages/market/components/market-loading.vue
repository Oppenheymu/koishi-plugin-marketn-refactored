<template>
  <div>
    <div class="el-loading-spinner">
      <svg class="circular" viewBox="25 25 50 50">
        <circle class="path" cx="50" cy="50" r="20" fill="none"></circle>
      </svg>
      <p class="el-loading-text">{{ t('marketPage.loading.title') }}</p>
      <p class="market-loading-detail">{{ t('marketPage.loading.registry', { value: endpoint }) }}</p>
    </div>
    <k-comment v-if="slow" type="warning" class="market-loading-warning">
      <p>{{ t('marketPage.loading.slow') }}</p>
      <p>
        {{ t('marketPage.loading.registry', { value: endpoint }) }}
        <template v-if="timeout"> · {{ t('marketPage.loading.timeoutLabel', { value: timeout }) }}</template>
        <template v-if="autoRoute"> · {{ t('marketPage.loading.autoRoute') }}</template>
      </p>
      <p style="margin-top: 0.5rem;">
        <el-button type="primary" size="small" @click="router.push('/settings/market')">{{ t('marketPage.loading.openMarketSettings') }}</el-button>
      </p>
    </k-comment>
  </div>
</template>

<script setup lang="ts">

import { router } from '@koishijs/client'
import { useMarketNextI18n } from '../../../i18n'

defineProps<{
  endpoint: string
  slow: boolean
  timeout: string
  autoRoute: boolean
}>()

const { t } = useMarketNextI18n()

</script>
