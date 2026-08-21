<template>
  <div class="dep-status-mark" aria-hidden="true">
    <market-icon :name="card.markIcon"></market-icon>
  </div>
  <div class="col-name">
    <span class="name-display" :title="props.name">
      <span class="name-label">{{ card.displayName }}</span>
      <span v-if="card.bundlePackage" class="dep-list-kind-pill" :title="t('dependencyCard.identity.bundle')">
        <market-icon name="file-archive"></market-icon>
        {{ t('dependencyCard.identity.bundle') }}
      </span>
    </span>
    <span class="name-full" :title="props.name">{{ props.name }}</span>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import MarketIcon from '../../../../market/icons'
import { useMarketNextI18n } from '../../../../i18n'
import { cardContextKey } from '../card/use-card'

const { card, props } = inject(cardContextKey)!
const { t } = useMarketNextI18n()
</script>
