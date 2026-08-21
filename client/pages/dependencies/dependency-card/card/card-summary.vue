<template>
  <p v-if="card.summaryText" class="dep-summary-text" :title="card.summaryText">
    {{ card.summaryText }}
  </p>
  <p v-if="card.showDetailText" :class="['dep-status-text', { danger: card.statusClass === 'error' }]">
    {{ card.detailText }}
  </p>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { cardContextKey } from './use-card'

const { card } = inject(cardContextKey)!
</script>
