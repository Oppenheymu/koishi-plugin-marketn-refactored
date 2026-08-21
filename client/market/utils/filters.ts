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

// 日期过滤表：顺序沿用旧实现的 else-if 链（<= 必须先于 < 匹配）。
const dateFilterTable = [
  { prefix: 'updated:within:', field: 'updated', op: 'within' },
  { prefix: 'created:within:', field: 'created', op: 'within' },
  { prefix: 'updated:<=', field: 'updated', op: '<=' },
  { prefix: 'updated:>=', field: 'updated', op: '>=' },
  { prefix: 'updated:<', field: 'updated', op: '<' },
  { prefix: 'updated:>', field: 'updated', op: '>' },
  { prefix: 'created:<=', field: 'created', op: '<=' },
  { prefix: 'created:>=', field: 'created', op: '>=' },
  { prefix: 'created:<', field: 'created', op: '<' },
  { prefix: 'created:>', field: 'created', op: '>' },
] as const

function matchDateFilter(word: string, index: MarketSearchIndex): boolean | undefined {
  for (const { prefix, field, op } of dateFilterTable) {
    if (!word.startsWith(prefix)) continue
    const value = word.slice(prefix.length)
    if (op === 'within') {
      return withinDays(index[field === 'updated' ? 'updatedTimestamp' : 'createdTimestamp'], value)
    }
    return compareDate(
      index[field === 'updated' ? 'updatedAt' : 'createdAt'],
      index[field === 'updated' ? 'updatedTimestamp' : 'createdTimestamp'],
      op,
      value,
    )
  }
}

interface FlagContext {
  data: SearchObject
  index: MarketSearchIndex
  config: ValidateConfig
}

// is:/not: 谓词表；installed/bundle 之外的字段依赖 manifest 存在。
const flagPredicates: Record<string, (ctx: FlagContext) => boolean> = {
  verified: ({ data }) => data.verified,
  insecure: ({ data }) => data.insecure,
  portable: ({ data }) => data.portable,
  preview: ({ data }) => !!data.manifest?.preview,
  installed: ({ data, config }) => !!config.installed?.(data),
  bundle: ({ index }) => index.bundle,
}

function matchFlagFilter(word: string, ctx: FlagContext): boolean | undefined {
  const negate = word.startsWith('not:')
  if (!negate && !word.startsWith('is:')) return undefined
  const key = negate ? word.slice(4) : word.slice(3)
  const predicate = flagPredicates[key]
  const manifestOnly = key !== 'installed' && key !== 'bundle'
  if (!predicate || (manifestOnly && !ctx.data.manifest)) return negate
  return negate ? !predicate(ctx) : predicate(ctx)
}

export function validate(data: SearchObject, word: string, config: ValidateConfig = {}) {
  const index = config.index ?? getSearchIndex(data)
  const dateResult = matchDateFilter(word, index)
  if (dateResult !== undefined) return dateResult
  const flagResult = matchFlagFilter(word, { data, index, config })
  if (flagResult !== undefined) return flagResult

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
    } else if (word.includes(':')) {
      return true
    }
  } else {
    if (word.includes(':')) {
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
