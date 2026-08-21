import type { Dict } from '@koishijs/client'
import type { SearchObject } from '@koishijs/registry'
import type { MarketConfig } from './categories'
import { getFiltered, getVisible } from './filters'
import { getSearchIndex, getSearchScoreByIndex, getSearchWords, type MarketSearchIndex } from './search-index'

interface Comparator {
  icon: string
  hidden?: boolean
  compare?(a: SearchObject, b: SearchObject, words: string[], config?: MarketConfig): number
}

export const comparators: Dict<Comparator> = {
  default: {
    icon: 'solid:all',
    compare: (a, b, words) => {
      const searchWords = getSearchWords(words)
      const now = Date.now()
      const delta = getSearchScoreByIndex(getSearchIndex(b), searchWords, now) - getSearchScoreByIndex(getSearchIndex(a), searchWords, now)
      return delta || b.updatedAt.localeCompare(a.updatedAt)
    },
  },
  recommend: {
    icon: 'award',
  },
  download: {
    icon: 'download',
    compare: (a, b) => (b.downloads?.lastMonth ?? 0) - (a.downloads?.lastMonth ?? 0),
  },
  created: {
    icon: 'heart-pulse',
    compare: (a, b) => b.createdAt.localeCompare(a.createdAt),
  },
  updated: {
    icon: 'tag',
    compare: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  },
}

function getSortConfig(words: string[]) {
  for (let word of words) {
    if (!word.startsWith('sort:')) continue
    let order = 1
    if (word.endsWith('-asc')) {
      order = -1
      word = word.slice(0, -4)
    } else if (word.endsWith('-desc')) {
      word = word.slice(0, -5)
    }
    const key = word.slice(5)
    if (comparators[key]) return { key, order }
  }
  return { key: 'default', order: 1 }
}

function sortRecommendMarket(market: SearchObject[], order: number, config?: MarketConfig) {
  const now = Date.now()
  return market
    .map(data => ({ data, index: getSearchIndex(data) }))
    .map(item => ({ ...item, score: getRecommendScore(item.data, item.index, config, now) }))
    .sort((a, b) => {
      const delta = b.score - a.score
      return (delta || compareRecommendFallback(a.data, b.data)) * order
    })
    .map(item => item.data)
}

function sortMarket(market: SearchObject[], words: string[], config?: MarketConfig) {
  const { key, order } = getSortConfig(words)
  if (key === 'recommend') return sortRecommendMarket(market, order, config)
  if (key !== 'default') {
    const comparator = comparators[key]
    return market.slice().sort((a, b) => comparator.compare!(a, b, words, config) * order)
  }
  const searchWords = getSearchWords(words)
  const now = Date.now()
  return market
    .map(data => ({ data, index: getSearchIndex(data) }))
    .map(item => ({ ...item, score: getSearchScoreByIndex(item.index, searchWords, now) }))
    .sort((a, b) => {
      const delta = b.score - a.score
      return (delta || b.index.updatedAt.localeCompare(a.index.updatedAt)) * order
    })
    .map(item => item.data)
}

export function getSortedPrepared(market: SearchObject[], words: string[], config?: MarketConfig) {
  return sortMarket(market, words, config)
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function getDaysSince(timestamp: number, now: number) {
  if (!Number.isFinite(timestamp)) return Infinity
  return Math.max(0, (now - timestamp) / 86400000)
}

function sigmoid(value: number, center: number, steepness: number) {
  return 1 / (1 + Math.exp(-(value - center) * steepness))
}

function getFreshnessScore(days: number) {
  if (!Number.isFinite(days)) return 0
  if (days <= 30) return 1
  if (days <= 90) return 0.75
  if (days <= 180) return 0.45
  return Math.exp(-days / 720)
}

function hasPackageLink(data: SearchObject) {
  const links = data.package.links ?? {}
  return !!(links.repository || links.homepage || links.bugs)
}

function getQualityScore(data: SearchObject, index: MarketSearchIndex) {
  const manifestDescription = data.manifest?.description
  const hasManifestDescription = typeof manifestDescription === 'string'
    ? !!manifestDescription.trim()
    : !!Object.values(manifestDescription ?? {}).some(value => String(value ?? '').trim())
  const packageDescription = (data.package as SearchObject['package'] & { description?: string }).description
  const keywords = data.package.keywords ?? []
  const license = data.license || (data.package as SearchObject['package'] & { license?: string }).license
  let score = 0
  if (hasManifestDescription) score += 0.22
  if (packageDescription?.trim()) score += 0.18
  if (index.category && index.category !== 'other') score += 0.14
  if (keywords.length >= 3) score += 0.12
  if (data.package.maintainers?.length) score += 0.10
  if (license) score += 0.08
  if (!index.bundle) score += 0.08
  return clamp(score)
}

function getTrustScore(data: SearchObject) {
  let score = 0
  if (data.verified) score += 0.55
  if (data.portable) score += 0.15
  if (hasPackageLink(data)) score += 0.10
  return clamp(score)
}

function getExplorationScore(downloads: number, maintenance: number, quality: number) {
  const lowDownloadBoost = 1 - sigmoid(Math.log10(downloads + 1), 2.2, 1.25)
  const recentBoost = maintenance
  const qualityFloor = clamp((quality - 0.35) / 0.65)
  return clamp(lowDownloadBoost * recentBoost * qualityFloor)
}

function getRiskMultiplier(data: SearchObject) {
  if (data.insecure || data.manifest?.insecure) return 0.15
  if ((data as SearchObject & { deprecated?: unknown }).deprecated || data.package.deprecated) return 0.25
  if (data.manifest?.preview === true) return 0.60
  return 1
}

function getRecommendScore(data: SearchObject, index: MarketSearchIndex, config: MarketConfig | undefined, now: number) {
  const downloads = Math.max(0, data.downloads?.lastMonth ?? 0)
  const updatedDays = getDaysSince(index.updatedTimestamp, now)
  const createdDays = getDaysSince(index.createdTimestamp, now)
  const popularity = sigmoid(Math.log10(downloads + 1), 2.6, 1.15)
  const maintenance = Number.isFinite(updatedDays) ? Math.exp(-updatedDays / 120) : 0
  const freshness = getFreshnessScore(createdDays)
  const trust = getTrustScore(data)
  const quality = getQualityScore(data, index)
  const exploration = getExplorationScore(downloads, maintenance, quality)
  let score = 100 * (
    0.30 * popularity
    + 0.24 * maintenance
    + 0.16 * freshness
    + 0.12 * trust
    + 0.10 * quality
    + 0.08 * exploration
  )
  score *= getRiskMultiplier(data)
  if (config?.installed?.(data)) score *= 0.18
  return score
}

function compareRecommendFallback(a: SearchObject, b: SearchObject) {
  const downloadDelta = (b.downloads?.lastMonth ?? 0) - (a.downloads?.lastMonth ?? 0)
  if (downloadDelta) return downloadDelta
  const updatedDelta = b.updatedAt.localeCompare(a.updatedAt)
  if (updatedDelta) return updatedDelta
  const createdDelta = b.createdAt.localeCompare(a.createdAt)
  if (createdDelta) return createdDelta
  return a.package.name.localeCompare(b.package.name)
}
