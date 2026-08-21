<template>
  <k-comment v-if="store.market.debug" type="primary" class="market-debug">
    <p>{{ t('marketPage.debug.performance', { source: formatSource(store.market.debug.source), endpoint: store.market.debug.endpoint || store.market.registry || t('marketPage.registry.unknown') }) }}</p>
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

import { computed } from 'vue'
import { store } from '@koishijs/client'
import { useMarketNextI18n } from '../../../../i18n'

const props = defineProps<{
  clientDebug: {
    timings?: Record<string, number>
    total?: number
    matched?: number
    visible?: number
    rendered?: number
  }
}>()

const { t, locale } = useMarketNextI18n()

const debugItems = computed(() => {
  const debug = store.market?.debug
  if (!debug) return []
  return [
    [t('marketPage.debug.objectCount'), formatNumber(debug.objects ?? store.market?.total)],
    [t('marketPage.debug.decodedSize'), formatSize(debug.size)],
    [t('marketPage.debug.wireSize'), formatSize(debug.wireSize)],
    [t('marketPage.debug.encoding'), formatEncoding(debug.contentEncoding)],
    [t('marketPage.debug.compressionRatio'), formatCompressionRatio(debug.size, debug.wireSize)],
    [t('marketPage.debug.candidates'), formatNumber(debug.candidates)],
    [t('marketPage.debug.preferredEndpoint'), debug.preferredEndpoint || '-'],
    [t('marketPage.debug.fallbackReason'), formatFallbackReason(debug.fallbackReason)],
    ['Hash', debug.hash || '-'],
    ['ETag', debug.etag || '-'],
    ['Last-Modified', debug.lastModified || '-'],
    [t('marketPage.debug.cacheTime'), debug.cachedAt ? formatTime(debug.cachedAt) : '-'],
    [t('marketPage.debug.validationTime'), debug.validatedAt ? formatTime(debug.validatedAt) : '-'],
    [t('marketPage.debug.frontendMatched'), props.clientDebug.matched == null ? '-' : `${props.clientDebug.matched} / ${props.clientDebug.total ?? '-'}`],
    [t('marketPage.debug.loadedRendered'), props.clientDebug.visible == null ? '-' : `${props.clientDebug.visible} / ${props.clientDebug.rendered ?? '-'}`],
  ].map(([label, value]) => ({ label, value }))
})

const debugTimings = computed(() => {
  return Object
    .entries({
      ...(store.market?.debug?.timings ?? {}),
      ...(props.clientDebug.timings ?? {}),
    })
    .filter(([, value]) => typeof value === 'number')
})

const debugPhases = computed(() => {
  const debug = store.market?.debug
  if (!debug) return []
  return [
    [t('marketPage.debug.initial'), debug.initial],
    [t('marketPage.debug.background'), debug.refresh],
  ].filter(([, value]) => value).map(([label, value]) => ({
    label,
    value: formatDebugPhase(value as any),
  }))
})

const debugRoutes = computed(() => store.market?.debug?.routeScores?.slice(0, 6) ?? [])

function formatTime(value: number) {
  return new Date(value).toLocaleString(locale.value)
}

function formatSource(source?: string) {
  const labels: Record<string, string> = {
    'network': t('marketPage.debug.sourceNetwork'),
    'disk-cache': t('marketPage.debug.sourceDiskCache'),
    'http-304': t('marketPage.debug.sourceHttp304'),
    'hash-cache': t('marketPage.debug.sourceHashCache'),
    'legacy': t('marketPage.debug.sourceLegacy'),
  }
  return source ? labels[source] || source : t('marketPage.debug.unknown')
}

function formatTimingName(name: string) {
  const labels: Record<string, string> = {
    request: t('marketPage.debug.request'),
    hash: 'Hash',
    parse: t('marketPage.debug.parse'),
    apply: t('marketPage.debug.apply'),
    total: t('marketPage.debug.total'),
    cacheRead: t('marketPage.debug.cacheRead'),
    cacheParse: t('marketPage.debug.cacheParse'),
    payloadData: t('marketPage.debug.payloadData'),
    payload: t('marketPage.debug.payload'),
    frontendSort: t('marketPage.debug.frontendSort'),
    frontendFilter: t('marketPage.debug.frontendFilter'),
    frontendVirtual: t('marketPage.debug.frontendVirtual'),
  }
  return labels[name] || name
}

function formatDuration(value: number) {
  return `${Math.round(value)}ms`
}

function formatDebugPhase(value: {
  source?: string
  endpoint?: string
  timings?: Record<string, number>
  contentEncoding?: string
  wireSize?: number
  fallbackReason?: string
}) {
  const parts = [
    formatSource(value.source),
    shortEndpoint(value.endpoint),
  ]
  if (value.fallbackReason) parts.push(formatFallbackReason(value.fallbackReason))
  if (value.timings?.total != null) parts.push(formatDuration(value.timings.total))
  if (value.contentEncoding) parts.push(value.contentEncoding)
  if (value.wireSize) parts.push(formatSize(value.wireSize))
  return parts.filter(Boolean).join(' / ')
}

function formatFallbackReason(value?: string) {
  switch (value) {
    case 'primary-failed': return t('marketPage.debug.primaryFailed')
    case 'primary-slow': return t('marketPage.debug.primarySlow')
    case 'rescue': return t('marketPage.debug.rescue')
    default: return '-'
  }
}

function formatSize(value?: number) {
  if (value == null) return '-'
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)}MB`
  if (value > 1024) return `${(value / 1024).toFixed(1)}KB`
  return `${value}B`
}

function formatEncoding(value?: string) {
  return value || 'identity'
}

function formatCompressionRatio(decoded?: number, encoded?: number) {
  if (!decoded || !encoded) return '-'
  if (encoded >= decoded) return t('marketPage.debug.uncompressed')
  return `${(decoded / encoded).toFixed(1)}x`
}

function shortEndpoint(value?: string) {
  if (!value) return '-'
  try {
    const url = new URL(value)
    return url.hostname
  } catch {
    return value
  }
}

function formatScore(value?: number) {
  return value == null ? '-' : value.toFixed(1)
}

function formatNumber(value?: number) {
  return value == null ? '-' : value.toLocaleString()
}

</script>

<style scoped src="./index.scss" lang="scss"></style>
