<template>
  <div :class="['dep-list-row', card.modeClass, card.statusClass]" :style="card.cardStyle">
    <row-name></row-name>
    <row-versions></row-versions>
    <row-actions></row-actions>
  </div>

  <card-dialogs></card-dialogs>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import { cardContextKey, useCard, type DependencyCardProps } from '../card/use-card'
import CardDialogs from '../card/card-dialogs.vue'
import RowActions from './row-actions.vue'
import RowName from './row-name.vue'
import RowVersions from './row-versions.vue'

const props = defineProps<DependencyCardProps>()
const card = useCard(props)
provide(cardContextKey, { card, props })
</script>

<style scoped src="./index.scss" lang="scss"></style>
