<template>
  <div class="bundle-hero">
    <div class="bundle-hero-icon">
      <k-icon name="cube"></k-icon>
    </div>
    <div class="bundle-hero-text">
      <div class="bundle-hero-title">
        <span>{{ title }}</span>
        <span class="bundle-badge">
          <market-icon name="file-archive"></market-icon>
          {{ t('bundle.label') }}
        </span>
      </div>
      <div v-if="activeBundle" class="bundle-hero-meta">
        <span>{{ activeBundle.package.name }}</span>
        <span class="dot">·</span>
        <span>{{ bundleVersion }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import MarketIcon from '../../../market/icons'
import { useMarketNextI18n } from '../../../i18n'
  import { bundleContextKey } from '../logic/bundle-context'

const { t } = useMarketNextI18n()
const { title, activeBundle, bundleVersion } = inject(bundleContextKey)!
</script>
