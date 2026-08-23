import { beforeEach, describe, expect, it } from 'vitest'

/**
 * @file 头像候选链生成的单元测试。
 *
 * 验证候选顺序与筛选规则:显式 avatar → 图片后缀的主页 url → gravatar
 * 镜像族(自配源最优先且去重)→ npm 代理;无邮箱时无 gravatar 系候选。
 */

import { getUserAvatarCandidates } from '../candidates'

const EMAIL = 'Dev@Example.com'

describe('getUserAvatarCandidates', () => {
    it('显式 avatar 字段排在候选链最前', () => {
        const candidates = getUserAvatarCandidates({
            name: 'a', email: EMAIL, avatar: 'https://example.com/me.png',
        } as any)
        expect(candidates[0]).toMatchObject({ url: 'https://example.com/me.png', source: 'explicit' })
    })

    it('data: URI 的显式 avatar 也接受', () => {
        const candidates = getUserAvatarCandidates({
            name: 'a', email: EMAIL, avatar: 'data:image/png;base64,xxx',
        } as any)
        expect(candidates[0]?.url).toBe('data:image/png;base64,xxx')
    })

    it('主页 url 仅当本身是图片地址才进候选', () => {
        const withImage = getUserAvatarCandidates({ name: 'a', email: EMAIL, url: 'https://a.dev/avatar.jpg' } as any)
        expect(withImage.some(item => item.source === 'url')).toBe(true)
        const withPage = getUserAvatarCandidates({ name: 'a', email: EMAIL, url: 'https://a.dev' } as any)
        expect(withPage.some(item => item.source === 'url')).toBe(false)
    })

    it('有邮箱时生成 gravatar 镜像族与 npm 代理候选,d=404 逐镜像回退', () => {
        const candidates = getUserAvatarCandidates({ name: 'a', email: EMAIL } as any)
        const gravatars = candidates.filter(item => item.source === 'gravatar')
        expect(gravatars.length).toBeGreaterThanOrEqual(4)
        for (const item of gravatars) {
            expect(item.url).toContain('/avatar/')
            expect(item.url).toContain('d=404')
            expect(item.cacheKey).toBe(gravatars[0]!.cacheKey)
        }
        expect(candidates.at(-1)?.source).toBe('npm-avatar')
        expect(candidates.at(-1)?.url).toContain('https://www.npmjs.com/npm-avatar/')
    })

    it('自配 gravatar 源最优先且与内置镜像去重', () => {
        const candidates = getUserAvatarCandidates({ name: 'a', email: EMAIL } as any, 'https://s.gravatar.com/avatar/')
        const gravatars = candidates.filter(item => item.source === 'gravatar')
        expect(gravatars.map(item => item.url)).toHaveLength(new Set(gravatars.map(item => item.url)).size)
        expect(candidates[0]?.url.startsWith('https://s.gravatar.com/avatar/')).toBe(true)
    })

    it('无邮箱时没有 gravatar/npm 候选', () => {
        const candidates = getUserAvatarCandidates({ name: 'a' } as any)
        expect(candidates).toHaveLength(0)
    })
})
