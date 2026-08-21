import type { SearchObject, User } from '@koishijs/registry'
import { getUsers } from './avatars'
import type { MarketConfig } from './categories'
import {
  getSearchIndex,
  getSimilarityByIndex,
  normalizeFilterWords,
  normalizePackageName,
  type MarketSearchIndex,
} from './search-index'

export interface ValidateConfig extends MarketConfig {
  users?: User[]
  index?: MarketSearchIndex
}

export function getVisible(market: SearchObject[], words: string[]) {
  return market?.slice().filter((data) => {
    return (!data.manifest?.hidden || words.includes('show:hidden'))
      && (!(data as SearchObject & { deprecated?: unknown }).deprecated || words.includes('show:deprecated'))
  })
}

export function getFiltered(market: SearchObject[], words: string[], config?: MarketConfig) {
  const filters = normalizeFilterWords(words)
  if (!filters.length) return market
  return market.filter((data) => {
    const index = getSearchIndex(data)
    return filters.every((word) => {
      return validate(data, word, { ...config, index, users: index.users })
    })
  })
}

export function getSilentFiltered(market: SearchObject[], words: string[], config?: MarketConfig) {
  const filters = normalizeFilterWords(words)
  if (!filters.length) return market
  return market.filter((data) => {
    const index = getSearchIndex(data)
    return !filters.some((word) => {
      return validate(data, word, { ...config, index, users: index.users })
    })
  })
}

export function parseSilentFilters(value?: string | string[]) {
  const source = Array.isArray(value) ? value : (value ?? '').split(/\n+/g)
  return normalizeFilterWords(source.flatMap(item => String(item).split(/[\s,，;；]+/g)))
}

const modifiers = ['show:', 'sort:', 'limit:']

export function hasFilter(words: string[]) {
  return words.filter(w => w && modifiers.every(prefix => !w.startsWith(prefix))).length > 0
}

const operators = ['is', 'not', 'created', 'updated', 'impl', 'locale', 'using', 'category', 'email', 'show', 'sort', 'limit']

export function validateWord(word: string) {
  if (!word.includes(':')) return true
  const [key] = word.split(':', 1)
  return operators.includes(key)
}

export function validate(data: SearchObject, word: string, config: ValidateConfig = {}) {
  const index = config.index ?? getSearchIndex(data)
  if (word.startsWith('updated:within:')) {
    return withinDays(index.updatedTimestamp, word.slice(15))
  } else if (word.startsWith('created:within:')) {
    return withinDays(index.createdTimestamp, word.slice(15))
  } else if (word.startsWith('updated:<=')) {
    return compareDate(index.updatedAt, index.updatedTimestamp, '<=', word.slice(10))
  } else if (word.startsWith('updated:>=')) {
    return compareDate(index.updatedAt, index.updatedTimestamp, '>=', word.slice(10))
  } else if (word.startsWith('updated:<')) {
    return compareDate(index.updatedAt, index.updatedTimestamp, '<', word.slice(9))
  } else if (word.startsWith('updated:>')) {
    return compareDate(index.updatedAt, index.updatedTimestamp, '>', word.slice(9))
  } else if (word.startsWith('created:<=')) {
    return compareDate(index.createdAt, index.createdTimestamp, '<=', word.slice(10))
  } else if (word.startsWith('created:>=')) {
    return compareDate(index.createdAt, index.createdTimestamp, '>=', word.slice(10))
  } else if (word.startsWith('created:<')) {
    return compareDate(index.createdAt, index.createdTimestamp, '<', word.slice(9))
  } else if (word.startsWith('created:>')) {
    return compareDate(index.createdAt, index.createdTimestamp, '>', word.slice(9))
  }

  if (data.manifest) {
    const { locales, service } = data.manifest
    if (word.startsWith('impl:')) {
      return service.implements.includes(word.slice(5))
    } else if (word.startsWith('locale:')) {
      return locales.includes(word.slice(7))
    } else if (word.startsWith('using:')) {
      const name = word.slice(6)
      return service.required.includes(name) || service.optional.includes(name)
    } else if (word.startsWith('category:')) {
      return index.category === word.slice(9)
    } else if (word.startsWith('email:')) {
      const users = config.users ?? getUsers(data)
      const target = word.slice(6)
      return users.some(({ email }) => email?.toLowerCase() === target)
    } else if (word.startsWith('is:')) {
      if (word === 'is:verified') return data.verified
      if (word === 'is:insecure') return data.insecure
      if (word === 'is:portable') return data.portable
      if (word === 'is:preview') return !!data.manifest.preview
      if (word === 'is:installed') return !!config.installed?.(data)
      if (word === 'is:bundle') return index.bundle
      return false
    } else if (word.startsWith('not:')) {
      if (word === 'not:verified') return !data.verified
      if (word === 'not:insecure') return !data.insecure
      if (word === 'not:portable') return !data.portable
      if (word === 'not:preview') return !data.manifest.preview
      if (word === 'not:installed') return !config.installed?.(data)
      if (word === 'not:bundle') return !index.bundle
      return true
    } else if (word.includes(':')) {
      return true
    }
  } else {
    if (word.startsWith('is:')) {
      if (word === 'is:installed') return !!config.installed?.(data)
      if (word === 'is:bundle') return index.bundle
      return false
    } else if (word.startsWith('not:')) {
      if (word === 'not:installed') return !config.installed?.(data)
      if (word === 'not:bundle') return !index.bundle
      return true
    } else if (word.includes(':')) {
      return true
    }
  }

  return getSimilarityByIndex(index, normalizePackageName(word)) > 0
}

function parseQueryDate(value: string, endOfDay = false) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const suffix = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z'
    return Date.parse(value + suffix)
  }
  return Date.parse(value)
}

function compareDate(value: string, timestamp: number, operator: '<' | '<=' | '>' | '>=', query: string) {
  const left = timestamp
  const right = parseQueryDate(query, operator === '<=' || operator === '>')
  if (Number.isFinite(left) && Number.isFinite(right)) {
    if (operator === '<') return left < right
    if (operator === '<=') return left <= right
    if (operator === '>') return left > right
    return left >= right
  }
  if (operator === '<') return value < query
  if (operator === '<=') return value <= query
  if (operator === '>') return value > query
  return value >= query
}

function withinDays(timestamp: number, query: string) {
  if (!/^\d{1,4}$/.test(query)) return true
  if (!Number.isFinite(timestamp)) return false
  const days = Number(query)
  return timestamp >= Date.now() - days * 86400000
}
