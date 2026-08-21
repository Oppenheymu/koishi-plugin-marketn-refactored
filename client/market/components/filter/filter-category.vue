<template>
  <div class="market-filter-group">
    <div class="market-filter-title">
      <h2 class="text">{{ t('type.category') }}</h2>
    </div>
    <div
      v-for="key in categories" :key="key" class="market-filter-item"
      :class="{ active: filter.words.includes('category:' + key) }"
      @click="filter.toggleCategory('category:' + key, $event)">
      <span class="icon"><market-icon :name="'solid:' + key"></market-icon></span>
      <span class="text">{{ t(`category.${key}`) }}</span>
      <span class="spacer"></span>
      <span class="count" v-if="data">
        {{ filter.categoryCounts[key] ?? 0 }}
      </span>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { inject } from 'vue'
import { categories } from '../../utils'
import MarketIcon from '../../icons'
import { useMarketNextI18n } from '../../../i18n'
import { filterContextKey } from './filter-context'

const { filter, props } = inject(filterContextKey)!
const { t } = useMarketNextI18n()
const data = props.data
</script>
