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

import { computed, inject, onUnmounted, ref, watch } from 'vue'
import { SearchObject } from '@koishijs/registry'
import { useI18nText } from '@koishijs/components'
import { store } from '@koishijs/client'
import { badges, cacheAvatarFailure, fetchAndCacheAvatar, fetchCachedAvatar, getCachedAvatarFromCandidates, getUserAvatarCandidates, getUserKey, getUsers, isAvatarFailureCached, isBundleSearchObject, resolveCategory, useMarketI18n, validate } from '../utils'
import { kConfig } from '../utils'
import MarketIcon from '../icons'

defineEmits(['query'])

const props = defineProps<{
  data: SearchObject
  gravatar?: string
}>()

const config = inject(kConfig, {})
const avatars = ref<Record<string, string>>({})
const avatarCursor = ref<Record<string, number>>({})
const avatarTasks = new Map<string, Promise<void>>()
let avatarHydrationTask = 0

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
    if (badges[type].hidden?.(config, 'card')) continue
    if (validate(props.data, badges[type].query)) return { type, ...badges[type] }
  }
})

const bundlePackage = computed(() => isBundleSearchObject(props.data))

type MarketUser = ReturnType<typeof getUsers>[number]

interface AvatarView {
  key: string
  user: MarketUser
  label: string
  initial: string
  src: string
  candidates: ReturnType<typeof getUserAvatarCandidates>
  signature: string
  candidate?: ReturnType<typeof getUserAvatarCandidates>[number]
  cached: boolean
}

const avatarViews = computed<AvatarView[]>(() => {
  return getUsers(props.data).map((user, index) => {
    const candidates = getUserAvatarCandidates(user, props.gravatar)
    const key = getAvatarIdentity(user, candidates, index)
    const cached = avatars.value[key] || getCachedAvatarFromCandidates(candidates)
    const candidate = cached ? undefined : getAvatarSource(key, candidates)
    return {
      key,
      user,
      label: user.name || user.username || user.email || key,
      initial: getAvatarInitial(user),
      src: cached || candidate?.url || '',
      candidates,
      signature: getAvatarSignature(candidates),
      candidate,
      cached: !!cached,
    }
  })
})

function getAvatarIdentity(user: MarketUser, candidates: ReturnType<typeof getUserAvatarCandidates>, index: number) {
  return getUserKey(user) || candidates[0]?.cacheKey || `${props.data.package.name}:${index}`
}

function getAvatarSignature(candidates: ReturnType<typeof getUserAvatarCandidates>) {
  return candidates.map(candidate => `${candidate.cacheKey}\n${candidate.source}\n${candidate.url}`).join('\n---\n')
}

function getAvatarInitial(user: MarketUser) {
  return (user.name || user.username || user.email || '?').trim().slice(0, 1).toUpperCase() || '?'
}

function getAvatarSource(key: string, candidates: ReturnType<typeof getUserAvatarCandidates>) {
  if (!candidates.length) return
  const start = Math.max(0, avatarCursor.value[key] || 0)
  for (let index = start; index < candidates.length; index++) {
    const candidate = candidates[index]
    if (!isAvatarSourceFailed(candidate)) return candidate
  }
  return
}

function isAvatarSourceFailed(candidate: ReturnType<typeof getUserAvatarCandidates>[number]) {
  return isAvatarFailureCached(getAvatarSourceKey(candidate))
}

function getAvatarSourceKey(candidate: ReturnType<typeof getUserAvatarCandidates>[number]) {
  return `${candidate.cacheKey}:${candidate.url}`
}

function handleAvatarRenderError(view: AvatarView) {
  const candidate = view.candidate
  if (!candidate) return
  cacheAvatarFailure(getAvatarSourceKey(candidate))
  const currentIndex = Math.max(0, view.candidates.findIndex(item => item.url === candidate.url && item.cacheKey === candidate.cacheKey))
  avatarCursor.value = { ...avatarCursor.value, [view.key]: currentIndex + 1 }
  const cached = getCachedAvatarFromCandidates(view.candidates)
  if (cached) avatars.value = { ...avatars.value, [view.key]: cached }
}

function handleAvatarRenderLoad(view: AvatarView) {
  if (!view.candidate) return
  const taskKey = `${view.key}:${view.signature}:${view.candidate.url}`
  if (avatarTasks.has(taskKey)) return
  const task = fetchAndCacheAvatar(view.candidate.cacheKey, view.candidate.url, false)
    .finally(() => {
      avatarTasks.delete(taskKey)
    })
  avatarTasks.set(taskKey, task)
}

function hydrateCachedAvatars() {
  avatarHydrationTask = 0
  for (const view of avatarViews.value) {
    if (!view.candidates.length || view.cached) continue
    const first = view.candidates[0]
    const taskKey = `${view.key}:${view.signature}:cache`
    if (avatarTasks.has(taskKey)) continue
    const task = fetchCachedAvatar(first.cacheKey)
      .then((src) => {
        const current = avatarViews.value.some(item => {
          return item.key === view.key && item.signature === view.signature && !item.src
        })
        if (!current) return
        if (src) avatars.value = { ...avatars.value, [view.key]: src }
      })
      .finally(() => {
        avatarTasks.delete(taskKey)
      })
    avatarTasks.set(taskKey, task)
  }
}

function scheduleAvatarHydration() {
  cancelAvatarHydration()
  const idle = (window as typeof window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
  }).requestIdleCallback
  if (idle) {
    avatarHydrationTask = idle(hydrateCachedAvatars, { timeout: 700 })
  } else {
    avatarHydrationTask = window.setTimeout(hydrateCachedAvatars, 120)
  }
}

function cancelAvatarHydration() {
  if (!avatarHydrationTask) return
  const idle = (window as typeof window & {
    cancelIdleCallback?: (handle: number) => void
  }).cancelIdleCallback
  if (idle) idle(avatarHydrationTask)
  else clearTimeout(avatarHydrationTask)
  avatarHydrationTask = 0
}

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
  if (diff < MINUTE) return t('time.just-now')
  if (diff < HOUR) return t('time.minutes-ago', [Math.max(1, Math.floor(diff / MINUTE))])
  if (diff < DAY) return t('time.hours-ago', [Math.floor(diff / HOUR)])
  if (diff < ABSOLUTE_DATE_THRESHOLD) return t('time.days-ago', [Math.floor(diff / DAY)])
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

watch(() => [props.data.package.name, props.gravatar], () => {
  cancelAvatarHydration()
  avatarCursor.value = {}
  avatarTasks.clear()
  avatars.value = {}
})

watch(() => avatarViews.value.map(view => `${view.key}:${view.signature}:${view.src ? '1' : '0'}`), () => {
  scheduleAvatarHydration()
}, { immediate: true })

onUnmounted(() => {
  cancelAvatarHydration()
  avatarTasks.clear()
})

</script>

<style lang="scss" scoped src="./package.scss"></style>
