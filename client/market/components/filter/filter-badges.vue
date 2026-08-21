<template>
  <div class="market-filter-group">
    <div class="market-filter-title">
      <h2 class="text">{{ t('type.filter') }}</h2>
    </div>
    <template v-for="(item, key) in badges" :key="key">
      <div
        v-if="!item.hidden?.(filter.config ?? {}, 'filter')"
        class="market-filter-item"
        :class="{ [key]: true, active: filter.words.includes(item.query), disabled: filter.words.includes(item.negate) }"
        @click="filter.toggleQuery(item, $event)">
        <span class="icon"><market-icon :name="item.icon || key"></market-icon></span>
        <span class="text">{{ t(`badge.${key}`) }}</span>
        <span class="spacer"></span>
        <span class="count" v-if="data">
          {{ filter.badgeCounts[key] ?? 0 }}
        </span>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { inject } from 'vue'
import { badges } from '../../utils'
import MarketIcon from '../../icons'
import { useMarketNextI18n } from '../../../i18n'
import { filterContextKey } from './filter-context'

const { filter, props } = inject(filterContextKey)!
const { t } = useMarketNextI18n()
const data = props.data
</script>
