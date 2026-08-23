import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * @file 头像双缓存 TTL 判定的单元测试。
 *
 * 用假时钟精确控制 24h 成功缓存与 10min 失败缓存的过期行为,以及
 * 候选链上的缓存命中顺序。
 */

import type { AvatarCandidate } from './candidates'
import {
  AVATAR_FAILURE_TTL,
  cacheAvatar,
  cacheAvatarFailure,
  getCachedAvatar,
  getCachedAvatarFromCandidates,
  isAvatarFailureCached,
  resetAvatarCachesForTest,
} from './cache'

const DAY_MS = 1000 * 60 * 60 * 24

function candidate(cacheKey: string): AvatarCandidate {
  return { url: `https://example.com/${cacheKey}.png`, source: 'explicit', cacheKey }
}

beforeEach(() => {
  vi.useFakeTimers()
  resetAvatarCachesForTest()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('失败缓存', () => {
  it('失败后处于冷却期,10 分钟后过期自动放行', () => {
    cacheAvatarFailure('url:bad')
    expect(isAvatarFailureCached('url:bad')).toBe(true)
    vi.setSystemTime(Date.now() + AVATAR_FAILURE_TTL - 1)
    expect(isAvatarFailureCached('url:bad')).toBe(true)
    vi.setSystemTime(Date.now() + 2)
    expect(isAvatarFailureCached('url:bad')).toBe(false)
  })

  it('写入成功缓存会清掉同 key 的失败标记', () => {
    cacheAvatarFailure('url:good')
    cacheAvatar('url:good', { data: 'aGk=', type: 'image/png', cachedAt: Date.now() })
    expect(isAvatarFailureCached('url:good')).toBe(false)
  })

  it('data: URI 无失败语义', () => {
    cacheAvatarFailure('data:image/png;base64,xxx')
    expect(isAvatarFailureCached('data:image/png;base64,xxx')).toBe(false)
  })
})

describe('成功缓存', () => {
  it('命中返回 data: URI,24 小时后过期清除', () => {
    cacheAvatar('url:hit', { data: 'aGk=', type: 'image/png', cachedAt: Date.now() })
    expect(getCachedAvatar('url:hit')).toBe('data:image/png;base64,aGk=')
    vi.setSystemTime(Date.now() + DAY_MS - 1)
    expect(getCachedAvatar('url:hit')).toBe('data:image/png;base64,aGk=')
    vi.setSystemTime(Date.now() + 2)
    expect(getCachedAvatar('url:hit')).toBeUndefined()
  })

  it('data: URI 直接透传,不占缓存', () => {
    expect(getCachedAvatar('data:image/png;base64,zz')).toBe('data:image/png;base64,zz')
  })

  it('getCachedAvatarFromCandidates 沿链返回第一个命中', () => {
    cacheAvatar('key-2', { data: 'Yg==', type: 'image/png', cachedAt: Date.now() })
    const result = getCachedAvatarFromCandidates([candidate('key-1'), candidate('key-2'), candidate('key-3')])
    expect(result).toBe('data:image/png;base64,Yg==')
    expect(getCachedAvatarFromCandidates([candidate('key-1')])).toBeUndefined()
  })
})
