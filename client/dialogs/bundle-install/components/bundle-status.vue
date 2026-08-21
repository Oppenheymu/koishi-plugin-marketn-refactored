<template>
  <div v-if="loading" class="bundle-loading">
    <span class="bundle-loading-spinner"></span>
    {{ t('bundle.loading') }}
  </div>
  <k-comment v-else-if="error" type="danger">
    <p>{{ error }}</p>
  </k-comment>
  <p v-else-if="bundle?.description" class="bundle-description">{{ bundle.description }}</p>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useMarketNextI18n } from '../../../i18n'
  import { bundleContextKey } from '../logic/bundle-context'

const { t } = useMarketNextI18n()
const { loading, error, bundle } = inject(bundleContextKey)!
</script>
