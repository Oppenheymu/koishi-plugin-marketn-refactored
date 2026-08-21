<template>
  <div class="market-filter-group">
    <div class="market-filter-title">
      <h2 class="text">{{ t('type.sort') }}</h2>
    </div>
    <template v-for="(item, key) in comparators" :key="key">
      <div
        v-if="!item.hidden"
        class="market-filter-item"
        :class="{ active: filter.activeSort[0] === key }"
        @click="filter.toggleSort('sort:' + key, $event)">
        <span class="icon"><market-icon :name="item.icon"></market-icon></span>
        <span class="text">{{ t(`sort.${key}`) }}</span>
        <span class="spacer"></span>
        <span class="order"><market-icon :name="filter.activeSort[1]"></market-icon></span>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { inject } from 'vue'
import { comparators } from '../../utils'
import MarketIcon from '../../icons'
import { useMarketNextI18n } from '../../../i18n'
import { filterContextKey } from './filter-context'

const { filter } = inject(filterContextKey)!
const { t } = useMarketNextI18n()
</script>
