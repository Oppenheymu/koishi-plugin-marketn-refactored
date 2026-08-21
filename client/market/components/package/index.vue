<template>
  <a :class="['market-package flex flex-col gap-3', 'cat-' + resolveCategory(data.category), { 'bundle-card': bundlePackage }]" target="_blank" :href="homepage">
    <div class="header flex flex-row gap-4">
      <div :class="['left', 'shrink-0', 'flex', 'flex-row', 'justify-center', 'items-center', 'cat-' + resolveCategory(data.category)]">
        <market-icon :name="'outline:' + resolveCategory(data.category)"></market-icon>
      </div>
      <div class="main flex flex-col justify-around overflow-hidden">
        <h2 class="top">
          <span class="title truncate" :title="data.shortname">{{ data.shortname }}</span>
          <el-tooltip v-if="badge" placement="right" :content="t(`badge.${badge.type}`)">
            <span :class="['icon', badge.type]" @click.stop.prevent="$emit('query', badge.query)">
              <market-icon :name="badge.icon || badge.type"></market-icon>
            </span>
          </el-tooltip>
        </h2>
        <div class="bottom">
          <span class="updated-meta" :style="updatedMetaStyle">
            <market-icon name="heart-pulse"></market-icon>{{ updatedAgo(data.updatedAt) }}
          </span>
        </div>
      </div>
      <div class="text-right grow-1 shrink-0">
        <slot name="action"></slot>
      </div>
    </div>
    <k-markdown inline class="desc" :source="tt(data.manifest?.description) ?? ''"></k-markdown>
    <div class="footer">
      <el-tooltip :content="timeAgo(data.updatedAt)" placement="top">
        <a class="truncate" target="_blank" :href="data.package.links.npm">
          <market-icon name="tag"></market-icon>{{ data.package.version }}
        </a>
      </el-tooltip>
      <template v-if="data.installSize">
        <span class="spacer"></span>
        <a class="truncate" target="_blank" :href="data.package.links.size">
          <market-icon name="file-archive"></market-icon>{{ formatSize(data.installSize) }}
        </a>
      </template>
      <template v-if="data.downloads">
        <span class="spacer"></span>
        <span class="truncate">
          <market-icon name="download"></market-icon>{{ data.downloads.lastMonth }}
        </span>
      </template>
      <template v-if="!data.installSize && !data.downloads">
        <span class="spacer"></span>
        <span class="truncate">
          <market-icon name="balance"></market-icon>{{ data.license }}
        </span>
      </template>
      <span class="long-spacer"></span>
      <div class="avatars">
        <el-tooltip v-for="view in avatarViews" :key="view.key" :content="view.label" placement="top">
          <span
            class="avatar"
            :class="{ placeholder: !view.src }"
            :data-initial="view.initial"
            @click.stop.prevent="view.user.email && $emit('query', 'email:' + view.user.email)"
          >
            <img
              v-if="view.src"
              :key="view.src"
              :src="view.src"
              loading="lazy"
              decoding="async"
              @error="handleAvatarRenderError(view)"
              @load="handleAvatarRenderLoad(view)"
            >
          </span>
        </el-tooltip>
      </div>
    </div>
  </a>
</template>

<script lang="ts" setup>

import { computed, inject } from 'vue'
import type { SearchObject } from '@koishijs/registry'
import { useI18nText } from '@koishijs/components'
import { store } from '@koishijs/client'
import { badges, isBundleSearchObject, resolveCategory, useMarketI18n, validate } from '../../utils'
import { kConfig } from '../../utils'
import MarketIcon from '../../icons'
import { useAvatar } from '../../avatar/use-avatar'

defineEmits(['query'])

const props = defineProps<{
  data: SearchObject
  gravatar?: string
}>()

const config = inject(kConfig, {})

const { avatarViews, handleAvatarRenderError, handleAvatarRenderLoad } = useAvatar(props)

const tt = useI18nText()

const homepage = computed(() => {
  const { homepage, repository } = props.data.package.links
  if (homepage) return homepage
  if (repository) return repository.replace(/^git\+/, '').replace(/\.git$/, '')
})

const badge = computed(() => {
  if (bundlePackage.value) {
    return {
      type: 'bundle',
      query: 'is:bundle',
      negate: 'not:bundle',
      icon: 'file-archive',
    }
  }
  for (const type in badges) {
    if (badges[type]!.hidden?.(config, 'card')) continue
    if (validate(props.data, badges[type]!.query)) return { type, ...badges[type]! }
  }
})

const bundlePackage = computed(() => isBundleSearchObject(props.data))

function formatValue(value: number) {
  return value >= 100 ? +value.toFixed() : +value.toFixed(1)
}

function formatSize(value: number) {
  if (value >= (1 << 20) * 1000) {
    return formatValue(value / (1 << 30)) + ' GB'
  } else if (value >= (1 << 10) * 1000) {
    return formatValue(value / (1 << 20)) + ' MB'
  } else {
    return formatValue(value / (1 << 10)) + ' KB'
  }
}

const { t, locale } = useMarketI18n()

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const ABSOLUTE_DATE_THRESHOLD = 7 * DAY

function getReferenceNow() {
  const serverNow = Number(store.market?.serverNow)
  return Number.isFinite(serverNow) && serverNow > 0 ? serverNow : Date.now()
}

function formatAbsoluteDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(locale.value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function timeAgo(time?: string) {
  const timestamp = Date.parse(time || '')
  if (!Number.isFinite(timestamp)) return t('time.unknown')
  const diff = Math.max(0, getReferenceNow() - timestamp)
  if (diff < MINUTE) return t('time.justNow')
  if (diff < HOUR) return t('time.minutesAgo', [Math.max(1, Math.floor(diff / MINUTE))])
  if (diff < DAY) return t('time.hoursAgo', [Math.floor(diff / HOUR)])
  if (diff < ABSOLUTE_DATE_THRESHOLD) return t('time.daysAgo', [Math.floor(diff / DAY)])
  return formatAbsoluteDate(timestamp)
}

function updatedAgo(time?: string) {
  return t('time.updated-ago', [timeAgo(time)])
}

const updatedMetaStyle = computed<Record<string, string>>(() => {
  const timestamp = Date.parse(props.data.updatedAt || '')
  if (!Number.isFinite(timestamp)) {
    return {
      '--update-heart-color': 'var(--fg3, var(--k-text-light, #888))',
      '--update-heart-opacity': '0.44',
      '--update-heart-glow-color': 'transparent',
      '--update-heart-glow-size': '0px',
    }
  }

  const age = Math.max(0, getReferenceNow() - timestamp)
  const freshness = Math.exp(-age / (75 * DAY))
  const redMix = Math.round(82 * freshness)
  const opacity = (0.44 + freshness * 0.46).toFixed(2)
  const glow = Math.max(0, 0.12 * (1 - age / (14 * DAY)))
  const glowSize = glow ? (0.8 + glow / 0.1).toFixed(1) : '0'
  return {
    '--update-heart-color': `color-mix(in srgb, #eb4d55 ${redMix}%, var(--fg3, var(--k-text-light, #888)))`,
    '--update-heart-opacity': opacity,
    '--update-heart-glow-color': glow ? `rgb(223 93 98 / ${glow.toFixed(2)})` : 'transparent',
    '--update-heart-glow-size': `${glowSize}px`,
  }
})

</script>

<style scoped src="./index.scss" lang="scss"></style>
