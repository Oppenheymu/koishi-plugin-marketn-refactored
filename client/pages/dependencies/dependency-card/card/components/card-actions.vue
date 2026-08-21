<template>
  <div v-if="card.showCardActions" :class="['dep-card-actions', { floating: card.floatingActions }]" @click.stop>
    <card-version-control></card-version-control>
    <card-action-buttons></card-action-buttons>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
  import { cardContextKey } from '../logic/use-card'
  import CardActionButtons from './card-action-buttons.vue'
  import CardVersionControl from './card-version-control.vue'

const { card } = inject(cardContextKey)!
</script>
