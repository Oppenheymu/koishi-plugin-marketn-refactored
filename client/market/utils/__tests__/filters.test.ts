import type { SearchObject } from '@koishijs/registry'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketSearchIndex } from '../search-index'

vi.mock('../avatar/avatars', () => ({
  getUsers: vi.fn(() => []),
}))

vi.mock('./search-index', () => ({
  getSearchIndex: vi.fn(() => { throw new Error('tests must pass config.index') }),
  getSimilarityByIndex: vi.fn(() => 0),
  normalizeFilterWords: (words: string[]) => words.map(word => word.trim().toLowerCase()).filter(Boolean),
  normalizePackageName: (name: string) => name,
}))

import { getSimilarityByIndex } from '../search-index'
import { validate } from '../filters'

const NOW = new Date('2026-08-21T12:00:00.000Z')

function makeIndex(overrides: Partial<MarketSearchIndex> = {}): MarketSearchIndex {
  return {
    users: [],
    normalizedName: 'chat',
    searchTexts: [],
    category: 'general',
    bundle: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    createdTimestamp: Date.parse('2025-01-01T00:00:00.000Z'),
    updatedTimestamp: Date.parse('2026-08-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeData(overrides: Record<string, unknown> = {}) {
  return {
    package: { name: 'koishi-plugin-chat' },
    verified: true,
    insecure: false,
    portable: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    manifest: {
      locales: ['zh-CN', 'en-US'],
      service: { required: ['database'], optional: ['console'], implements: ['chat'] },
      preview: '/assets/preview.png',
    },
    ...overrides,
  } as unknown as SearchObject
}

describe('validate date filters', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }))
  afterEach(() => vi.useRealTimers())

  it.each([
    ['updated:within:30', true],
    ['updated:within:7', false],
    ['created:within:1000', true],
    ['updated:<=2026-01-01', false],
    ['updated:>=2026-01-01', true],
    ['updated:<2026-08-02', true],
    ['updated:>2026-08-02', false],
    ['created:<=2025-01-01', true],
    ['created:>=2025-06-01', false],
    ['created:<2025-06-01', true],
    ['created:>2025-06-01', false],
  ])('%s → %s', (word, expected) => {
    expect(validate(makeData(), word, { index: makeIndex() })).toBe(expected)
  })

  it('within: 非数字或非法时间戳时宽松返回', () => {
    expect(validate(makeData(), 'updated:within:abc', { index: makeIndex() })).toBe(true)
    expect(validate(makeData(), 'updated:within:7', {
      index: makeIndex({ updatedTimestamp: Number.NaN }),
    })).toBe(false)
  })
})

describe('validate is:/not: flags', () => {
  it('按 data/index/config 求值', () => {
    const index = makeIndex({ bundle: true })
    expect(validate(makeData(), 'is:verified', { index })).toBe(true)
    expect(validate(makeData({ verified: false }), 'is:verified', { index })).toBe(false)
    expect(validate(makeData(), 'is:preview', { index })).toBe(true)
    expect(validate(makeData(), 'is:bundle', { index })).toBe(true)
    expect(validate(makeData(), 'not:bundle', { index })).toBe(false)
    expect(validate(makeData({ insecure: true }), 'not:insecure', { index })).toBe(false)
  })

  it('is:installed 走 config.installed 回调', () => {
    const index = makeIndex()
    const installed = vi.fn(() => true)
    expect(validate(makeData(), 'is:installed', { index, installed })).toBe(true)
    expect(validate(makeData(), 'not:installed', { index, installed })).toBe(false)
    expect(installed).toHaveBeenCalledTimes(2)
  })

  it('未知 is:/not: 键的回退值：is → false，not → true', () => {
    const index = makeIndex()
    expect(validate(makeData(), 'is:whatever', { index })).toBe(false)
    expect(validate(makeData(), 'not:whatever', { index })).toBe(true)
  })

  it('无 manifest 时仅 installed/bundle 可判定，其余回退', () => {
    const index = makeIndex()
    const data = makeData({ manifest: undefined })
    expect(validate(data, 'is:installed', { index, installed: () => true })).toBe(true)
    expect(validate(data, 'is:preview', { index })).toBe(false)
    expect(validate(data, 'not:preview', { index })).toBe(true)
    expect(validate(data, 'not:installed', { index, installed: () => true })).toBe(false)
  })
})

describe('validate manifest filters', () => {
  const index = makeIndex()

  it('impl:/locale:/using:/category:', () => {
    const data = makeData()
    expect(validate(data, 'impl:chat', { index })).toBe(true)
    expect(validate(data, 'impl:other', { index })).toBe(false)
    expect(validate(data, 'locale:zh-CN', { index })).toBe(true)
    expect(validate(data, 'locale:fr-FR', { index })).toBe(false)
    expect(validate(data, 'using:database', { index })).toBe(true)
    expect(validate(data, 'using:console', { index })).toBe(true)
    expect(validate(data, 'using:unknown', { index })).toBe(false)
    expect(validate(data, 'category:general', { index })).toBe(true)
    expect(validate(data, 'category:adapter', { index })).toBe(false)
  })

  it('email: 匹配维护者邮箱（大小写不敏感）', () => {
    const data = makeData()
    const users = [{ email: 'Alice@Example.com' }]
    expect(validate(data, 'email:alice@example.com', { index, users })).toBe(true)
    expect(validate(data, 'email:bob@example.com', { index, users })).toBe(false)
  })
})

describe('validate fallback', () => {
  it('未知带冒号词宽松放行，纯文本走相似度', () => {
    const index = makeIndex()
    expect(validate(makeData(), 'weird:filter', { index })).toBe(true)
    vi.mocked(getSimilarityByIndex).mockReturnValue(0.5)
    expect(validate(makeData(), 'chat', { index })).toBe(true)
    vi.mocked(getSimilarityByIndex).mockReturnValue(0)
    expect(validate(makeData(), 'chat', { index })).toBe(false)
  })
})
