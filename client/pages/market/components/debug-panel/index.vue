<template>
  <k-comment v-if="store.market.debug" type="primary" class="market-debug">
    <p>{{ performanceText }}</p>
    <div class="market-debug-grid">
      <span v-for="item in debugItems" :key="item.label" class="market-debug-item">
        <span>{{ item.label }}</span>
        <span>{{ item.value }}</span>
      </span>
    </div>
    <div v-if="debugTimings.length" class="market-debug-timings">
      <span v-for="[key, value] in debugTimings" :key="key">{{ formatTimingName(key) }} {{ formatDuration(value) }}</span>
    </div>
    <div v-if="debugPhases.length" class="market-debug-timings">
      <span v-for="item in debugPhases" :key="item.label">{{ item.label }}: {{ item.value }}</span>
    </div>
    <div v-if="debugRoutes.length" class="market-debug-routes">
      <span v-for="route in debugRoutes" :key="route.endpoint" class="market-debug-route">
        {{ shortEndpoint(route.endpoint) }} score={{ formatScore(route.score) }}
        <template v-if="route.averageElapsed"> avg={{ formatDuration(route.averageElapsed) }}</template>
        <template v-if="route.contentEncoding"> {{ route.contentEncoding }}</template>
        <template v-if="route.cachedAt"> cache={{ formatTime(route.cachedAt) }}</template>
        <template v-if="route.coolingDown"> cooldown={{ formatTime(route.cooldownUntil) }}</template>
      </span>
    </div>
  </k-comment>
</template>

<script setup lang="ts">

import { store } from '@koishijs/client'
import { useDebugPanel, type ClientDebug } from './use-debug-panel'

const props = defineProps<{ clientDebug: ClientDebug }>()

const {
  performanceText,
  debugItems,
  debugTimings,
  debugPhases,
  debugRoutes,
  formatDuration,
  formatScore,
  formatTime,
  formatTimingName,
  shortEndpoint,
} = useDebugPanel(props.clientDebug)

</script>

<style scoped src="./index.scss" lang="scss"></style>
