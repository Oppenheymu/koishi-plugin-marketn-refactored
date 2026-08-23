import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * @file analyzeVersions 与 formatEndpoint 的单元测试。
 *
 * store/valueMap 用与 @koishijs/client 语义一致的最小桩替换,聚焦验证:
 * peer 兼容性判定矩阵(满足/不满足/缺失/optional)、deprecated 特判、
 * 版本查找优先级(getVersion > store.dependencies > store.packages)。
 */

const store = {
    registry: {} as any,
    dependencies: {} as any,
    packages: {} as any,
}

vi.mock('@koishijs/client', () => ({
    store,
    valueMap: (source: Record<string, any>, fn: (value: any, key: string) => any) => {
        const result: Record<string, any> = {}
        for (const key of Object.keys(source)) result[key] = fn(source[key], key)
        return result
    },
}))

const { analyzeVersions, formatEndpoint } = await import('../analyze')

/** 便捷构造:单版本 registry 元数据。 */
function registryWithVersion(peerDependencies: any, extra: any = {}) {
    return { '1.0.0': { peerDependencies, ...extra } }
}

beforeEach(() => {
    store.registry = {}
    store.dependencies = {}
    store.packages = {}
})

describe('analyzeVersions', () => {
    it('无 registry 且无手动缓存时返回 undefined', () => {
        expect(analyzeVersions('pkg-a', () => null)).toBeUndefined()
    })

    it('peer 满足期望范围时标 success', () => {
        store.registry = { 'pkg-a': registryWithVersion({ foo: '^1.0.0' }) }
        store.dependencies = { foo: { resolved: '1.2.0' } }
        const result = analyzeVersions('pkg-a', () => null) as any
        expect(result['1.0.0'].result).toBe('success')
        expect(result['1.0.0'].peers.foo).toMatchObject({ request: '^1.0.0', resolved: '1.2.0', result: 'success' })
    })

    it('peer 不满足期望范围时该 peer 与整版本标 danger', () => {
        store.registry = { 'pkg-a': registryWithVersion({ foo: '^1.0.0' }) }
        store.dependencies = { foo: { resolved: '2.0.0' } }
        const result = analyzeVersions('pkg-a', () => null) as any
        expect(result['1.0.0'].peers.foo.result).toBe('danger')
        expect(result['1.0.0'].result).toBe('danger')
    })

    it('必需 peer 缺失时标 danger', () => {
        store.registry = { 'pkg-a': registryWithVersion({ foo: '^1.0.0' }) }
        const result = analyzeVersions('pkg-a', () => null) as any
        expect(result['1.0.0'].peers.foo.result).toBe('danger')
        expect(result['1.0.0'].result).toBe('danger')
    })

    it('optional peer 缺失时仅标 primary,整版本不因此 danger', () => {
        store.registry = {
            'pkg-a': registryWithVersion({ foo: '^1.0.0' }, { peerDependenciesMeta: { foo: { optional: true } } }),
        }
        const result = analyzeVersions('pkg-a', () => null) as any
        expect(result['1.0.0'].peers.foo.result).toBe('primary')
        expect(result['1.0.0'].result).toBe('success')
    })

    it('deprecated 版本直接标 danger(即使 peer 全部满足)', () => {
        store.registry = { 'pkg-a': registryWithVersion({ foo: '^1.0.0' }, { deprecated: 'use v2' }) }
        store.dependencies = { foo: { resolved: '1.2.0' } }
        const result = analyzeVersions('pkg-a', () => null) as any
        expect(result['1.0.0'].result).toBe('danger')
    })

    it('getVersion 回调优先于 store.dependencies 与 store.packages', () => {
        store.registry = { 'pkg-a': registryWithVersion({ foo: '^1.0.0' }) }
        store.dependencies = { foo: { resolved: '2.0.0' } }
        store.packages = { foo: { package: { version: '2.1.0' } } }
        const result = analyzeVersions('pkg-a', () => '1.5.0') as any
        expect(result['1.0.0'].peers.foo.resolved).toBe('1.5.0')
        expect(result['1.0.0'].peers.foo.result).toBe('success')
    })

    it('缺 dependencies 时回退 store.packages 的版本元数据', () => {
        store.registry = { 'pkg-a': registryWithVersion({ foo: '^1.0.0' }) }
        store.packages = { foo: { package: { version: '1.1.0' } } }
        const result = analyzeVersions('pkg-a', () => null) as any
        expect(result['1.0.0'].peers.foo.resolved).toBe('1.1.0')
        expect(result['1.0.0'].result).toBe('success')
    })

    it('peer 含预发布版本时 includePrerelease 生效', () => {
        store.registry = { 'pkg-a': registryWithVersion({ foo: '^1.0.0-beta.1' }) }
        store.dependencies = { foo: { resolved: '1.0.0-beta.2' } }
        const result = analyzeVersions('pkg-a', () => null) as any
        expect(result['1.0.0'].peers.foo.result).toBe('success')
    })
})

describe('formatEndpoint', () => {
    it('URL 只保留 host 部分', () => {
        expect(formatEndpoint('https://registry.npmmirror.com/path?query=1')).toBe('registry.npmmirror.com')
    })

    it('无法解析的端点原样返回', () => {
        expect(formatEndpoint('relative-path')).toBe('relative-path')
    })
})
