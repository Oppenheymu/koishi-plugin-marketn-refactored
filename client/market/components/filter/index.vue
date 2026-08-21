<template>
  <filter-sort></filter-sort>
  <filter-badges></filter-badges>
  <filter-advanced></filter-advanced>
  <filter-category></filter-category>
</template>

<script lang="ts" setup>
import type { SearchObject } from '@koishijs/registry'
import { provide } from 'vue'
import { useFilter } from './use-filter'
import { filterContextKey, type FilterContext } from './filter-context'
import FilterAdvanced from './filter-advanced.vue'
import FilterBadges from './filter-badges.vue'
import FilterCategory from './filter-category.vue'
import FilterSort from './filter-sort.vue'

const props = defineProps<{
  modelValue: string[]
  data?: SearchObject[]
}>()

const emit = defineEmits(['update:modelValue'])

const filter = useFilter(props, emit)
const context: FilterContext = { filter, props }
provide(filterContextKey, context)
</script>

<style scoped src="./index.scss" lang="scss"></style>
