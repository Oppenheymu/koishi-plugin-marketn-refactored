<template>
  <div class="market-filter-group">
    <div class="market-filter-title">
      <h2 class="text">{{ t('type.sort') }}</h2>
    </div>
    <template v-for="(item, key) in comparators" :key="key">
      <div
        v-if="!item.hidden"
        class="market-filter-item"
        :class="{ active: activeSort[0] === key }"
        @click="toggleSort('sort:' + key, $event)">
        <span class="icon"><market-icon :name="item.icon"></market-icon></span>
        <span class="text">{{ t(`sort.${key}`) }}</span>
        <span class="spacer"></span>
        <span class="order"><market-icon :name="activeSort[1]"></market-icon></span>
      </div>
    </template>
  </div>
  <div class="market-filter-group">
    <div class="market-filter-title">
      <h2 class="text">{{ t('type.filter') }}</h2>
    </div>
    <template v-for="(item, key) in badges" :key="key">
      <div
        v-if="!item.hidden?.(config ?? {}, 'filter')"
        class="market-filter-item"
        :class="{ [key]: true, active: words.includes(item.query), disabled: words.includes(item.negate) }"
        @click="toggleQuery(item, $event)">
        <span class="icon"><market-icon :name="item.icon || key"></market-icon></span>
        <span class="text">{{ t(`badge.${key}`) }}</span>
        <span class="spacer"></span>
        <span class="count" v-if="data">
          {{ badgeCounts[key] ?? 0 }}
        </span>
      </div>
    </template>
  </div>
  <details class="market-filter-group market-filter-advanced" :open="advancedOpen || hasDateFilters" @toggle="onAdvancedToggle">
    <summary class="market-filter-title market-advanced-summary">
      <h2 class="text">{{ t('type.advanced') }}</h2>
      <span v-if="hasDateFilters" class="market-advanced-count">{{ activeDateFilterCount }}</span>
    </summary>
    <div class="market-date-filter">
      <label class="market-date-row">
        <span>{{ t('advanced.createdWithin') }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="4"
          :placeholder="t('advanced.daysPlaceholder')"
          :value="relativeDateFilters.createdWithin"
          @input="updateRelativeDateFilterFromEvent('createdWithin', $event)"
          @keydown.enter.prevent="commitRelativeDateFilterFromEvent('createdWithin', $event)"
          @blur="commitRelativeDateFilterFromEvent('createdWithin', $event)"
        >
      </label>
      <label class="market-date-row">
        <span>{{ t('advanced.updatedWithin') }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="4"
          :placeholder="t('advanced.daysPlaceholder')"
          :value="relativeDateFilters.updatedWithin"
          @input="updateRelativeDateFilterFromEvent('updatedWithin', $event)"
          @keydown.enter.prevent="commitRelativeDateFilterFromEvent('updatedWithin', $event)"
          @blur="commitRelativeDateFilterFromEvent('updatedWithin', $event)"
        >
      </label>
      <label class="market-date-row">
        <span>{{ t('advanced.createdAfter') }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="10"
          pattern="\d{4}-\d{2}-\d{2}"
          :placeholder="t('advanced.datePlaceholder')"
          :value="dateDrafts.createdAfter"
          @input="updateDateFilterFromEvent('createdAfter', $event)"
          @keydown.enter.prevent="commitDateFilterFromEvent('createdAfter', $event)"
          @blur="commitDateFilterFromEvent('createdAfter', $event)"
        >
      </label>
      <label class="market-date-row">
        <span>{{ t('advanced.createdBefore') }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="10"
          pattern="\d{4}-\d{2}-\d{2}"
          :placeholder="t('advanced.datePlaceholder')"
          :value="dateDrafts.createdBefore"
          @input="updateDateFilterFromEvent('createdBefore', $event)"
          @keydown.enter.prevent="commitDateFilterFromEvent('createdBefore', $event)"
          @blur="commitDateFilterFromEvent('createdBefore', $event)"
        >
      </label>
      <label class="market-date-row">
        <span>{{ t('advanced.updatedAfter') }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="10"
          pattern="\d{4}-\d{2}-\d{2}"
          :placeholder="t('advanced.datePlaceholder')"
          :value="dateDrafts.updatedAfter"
          @input="updateDateFilterFromEvent('updatedAfter', $event)"
          @keydown.enter.prevent="commitDateFilterFromEvent('updatedAfter', $event)"
          @blur="commitDateFilterFromEvent('updatedAfter', $event)"
        >
      </label>
      <label class="market-date-row">
        <span>{{ t('advanced.updatedBefore') }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="10"
          pattern="\d{4}-\d{2}-\d{2}"
          :placeholder="t('advanced.datePlaceholder')"
          :value="dateDrafts.updatedBefore"
          @input="updateDateFilterFromEvent('updatedBefore', $event)"
          @keydown.enter.prevent="commitDateFilterFromEvent('updatedBefore', $event)"
          @blur="commitDateFilterFromEvent('updatedBefore', $event)"
        >
      </label>
      <button v-if="hasDateFilters" class="market-date-clear" type="button" @click="clearDateFilters">
        {{ t('advanced.clearDates') }}
      </button>
    </div>
  </details>
  <div class="market-filter-group">
    <div class="market-filter-title">
      <h2 class="text">{{ t('type.category') }}</h2>
    </div>
    <div
      v-for="key in categories" :key="key" class="market-filter-item"
      :class="{ active: words.includes('category:' + key) }"
      @click="toggleCategory('category:' + key, $event)">
      <span class="icon"><market-icon :name="'solid:' + key"></market-icon></span>
      <span class="text">{{ t(`category.${key}`) }}</span>
      <span class="spacer"></span>
      <span class="count" v-if="data">
        {{ categoryCounts[key] ?? 0 }}
      </span>
    </div>
  </div>
</template>

<script lang="ts" setup>

import type { SearchObject } from '@koishijs/registry'
import { badges, categories, comparators } from '../../utils'
import MarketIcon from '../../icons'
import { useFilter } from '../composables/use-filter'

const props = defineProps<{
  modelValue: string[]
  data?: SearchObject[]
}>()

const emit = defineEmits(['update:modelValue'])

const {
  t,
  config,
  words,
  advancedOpen,
  dateDrafts,
  activeSort,
  hasDateFilters,
  activeDateFilterCount,
  relativeDateFilters,
  badgeCounts,
  categoryCounts,
  toggleSort,
  toggleQuery,
  toggleCategory,
  updateRelativeDateFilterFromEvent,
  commitRelativeDateFilterFromEvent,
  updateDateFilterFromEvent,
  commitDateFilterFromEvent,
  clearDateFilters,
  onAdvancedToggle,
} = useFilter(props, emit)

</script>

<style scoped src="./index.scss" lang="scss"></style>
