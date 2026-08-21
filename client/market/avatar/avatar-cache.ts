import { ref } from 'vue'
import { send } from '@koishijs/client'
import { createAvatarUrlCacheKey, normalizeAvatarUrl, type AvatarCandidate } from './avatar-candidates'

type AvatarCacheEntry = {
  data: string
  type: string
  cachedAt: number
}

type AvatarFailureEntry = {
  failedAt: number
}

const AVATAR_CACHE_TTL = 1000 * 60 * 60 * 24
const AVATAR_FAILURE_TTL = 1000 * 60 * 10
const AVATAR_CACHE_MAX = 256
const AVATAR_FAILURE_MAX = 256
const avatarCache: Record<string, AvatarCacheEntry> = {}
const avatarFailureCache = ref<Record<string, AvatarFailureEntry>>({})
const pendingAvatarRequests = new Map<string, Promise<string>>()

function isDataUrl(value: string) {
  return value.startsWith('data:')
}

function readAvatarCache() {
}

function pruneAvatarCache() {
  const now = Date.now()
  const entries = Object.entries(avatarCache)
    .filter(([, entry]) => now - entry.cachedAt < AVATAR_CACHE_TTL)
    .sort((a, b) => b[1].cachedAt - a[1].cachedAt)
    .slice(0, AVATAR_CACHE_MAX)
  for (const key of Object.keys(avatarCache)) delete avatarCache[key]
  Object.assign(avatarCache, Object.fromEntries(entries))
}

function pruneAvatarFailureCache() {
  const now = Date.now()
  avatarFailureCache.value = Object.fromEntries(Object.entries(avatarFailureCache.value)
    .filter(([, entry]) => now - entry.failedAt < AVATAR_FAILURE_TTL)
    .sort((a, b) => b[1].failedAt - a[1].failedAt)
    .slice(0, AVATAR_FAILURE_MAX))
}

function normalizeAvatarCacheKey(key: string) {
  return key.replace(/[^0-9A-Za-z:@._-]/g, '-').slice(0, 128) || createAvatarUrlCacheKey(key)
}

function cacheAvatar(cacheKey: string, entry: AvatarCacheEntry) {
  readAvatarCache()
  const key = normalizeAvatarCacheKey(cacheKey)
  delete avatarFailureCache.value[key]
  avatarCache[key] = entry
  pruneAvatarCache()
  pruneAvatarFailureCache()
}

export function cacheAvatarFailure(cacheKey: string) {
  if (isDataUrl(cacheKey)) return
  readAvatarCache()
  const key = normalizeAvatarCacheKey(cacheKey)
  avatarFailureCache.value = {
    ...avatarFailureCache.value,
    [key]: { failedAt: Date.now() },
  }
  pruneAvatarFailureCache()
}

export function isAvatarFailureCached(cacheKey: string) {
  if (isDataUrl(cacheKey)) return false
  readAvatarCache()
  const key = normalizeAvatarCacheKey(cacheKey)
  const entry = avatarFailureCache.value[key]
  if (!entry) return false
  if (Date.now() - entry.failedAt >= AVATAR_FAILURE_TTL) {
    delete avatarFailureCache.value[key]
    return false
  }
  return true
}

function getCachedAvatar(cacheKey: string) {
  if (isDataUrl(cacheKey)) return cacheKey
  readAvatarCache()
  const key = normalizeAvatarCacheKey(cacheKey)
  const entry = avatarCache[key]
  if (!entry) return
  if (Date.now() - entry.cachedAt >= AVATAR_CACHE_TTL) {
    delete avatarCache[key]
    return
  }
  return `data:${entry.type};base64,${entry.data}`
}

export function getCachedAvatarFromCandidates(candidates: AvatarCandidate[]) {
  for (const candidate of candidates) {
    const cached = getCachedAvatar(candidate.cacheKey)
    if (cached) return cached
  }
}

export async function fetchAndCacheAvatar(cacheKey: string, url: string, cacheFailure = true) {
  if (isDataUrl(url)) return url
  readAvatarCache()
  const key = normalizeAvatarCacheKey(cacheKey)
  const sourceUrl = normalizeAvatarUrl(url)
  const cached = getCachedAvatar(key)
  if (cached) return cached
  const pending = pendingAvatarRequests.get(key)
  if (pending) return pending
  const task = (async () => {
    const result = await (send('market/avatar', key, sourceUrl) ?? Promise.resolve(undefined))
      .catch(() => undefined) as { data?: string, type?: string, cached?: boolean } | undefined
    if (result?.data && result.type) {
      cacheAvatar(key, {
        data: result.data,
        type: result.type,
        cachedAt: Date.now(),
      })
      return `data:${result.type};base64,${result.data}`
    }
    if (cacheFailure) cacheAvatarFailure(key)
    return ''
  })().finally(() => {
    pendingAvatarRequests.delete(key)
  })
  pendingAvatarRequests.set(key, task)
  return task
}

export async function fetchCachedAvatar(cacheKey: string) {
  if (isDataUrl(cacheKey)) return cacheKey
  readAvatarCache()
  const key = normalizeAvatarCacheKey(cacheKey)
  const cached = getCachedAvatar(key)
  if (cached) return cached
  const pendingKey = `cache:${key}`
  const pending = pendingAvatarRequests.get(pendingKey)
  if (pending) return pending
  const task = (async () => {
    const result = await (send('market/avatar', key) ?? Promise.resolve(undefined))
      .catch(() => undefined) as { data?: string, type?: string, cached?: boolean } | undefined
    if (result?.data && result.type) {
      cacheAvatar(key, {
        data: result.data,
        type: result.type,
        cachedAt: Date.now(),
      })
      return `data:${result.type};base64,${result.data}`
    }
    return ''
  })().finally(() => {
    pendingAvatarRequests.delete(pendingKey)
  })
  pendingAvatarRequests.set(pendingKey, task)
  return task
}
