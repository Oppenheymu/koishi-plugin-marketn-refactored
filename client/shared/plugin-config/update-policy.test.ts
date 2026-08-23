import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * @file 更新忽略策略族的单元测试。
 *
 * store 用最小桩替换,聚焦验证忽略判定语义:候选版本筛选(比已装新/降序)、
 * 精确版本忽略、count 连坐、until 过期、禁检包短路、本地依赖无候选、
 * createUpdateIgnoreRule 的 options 覆盖。
 */

const store = {
    registry: {} as any,
    dependencies: {} as any,
}

vi.mock('@koishijs/client', () => ({
    store,
    useI18n: () => ({ t: (key: string) => key }),
}))

const { createUpdateIgnoreRule, getIgnoredUpdateVersion, getLatestVersion, hasUpdate, isUpdateIgnored } = await import('./update-policy')

/** 便捷布置:registry 提供三个版本,已装 1.0.0,候选即 [2.0.0, 1.1.0]。 */
function setupVersions(resolved = '1.0.0') {
    store.registry = { 'pkg-a': { '1.0.0': {}, '1.1.0': {}, '2.0.0': {} } }
    store.dependencies = { 'pkg-a': { resolved } }
}

beforeEach(() => {
    store.registry = {}
    store.dependencies = {}
})

describe('getLatestVersion / hasUpdate', () => {
    it('无忽略规则时返回最高候选版本', () => {
        setupVersions()
        expect(getLatestVersion('pkg-a')).toBe('2.0.0')
        expect(hasUpdate('pkg-a')).toBe(true)
    })

    it('已装最新版时无候选,hasUpdate 返回 undefined', () => {
        setupVersions('2.0.0')
        expect(getLatestVersion('pkg-a')).toBeUndefined()
        expect(hasUpdate('pkg-a')).toBeUndefined()
    })

    it('本地依赖(file 安装)不算升级候选', () => {
        setupVersions()
        store.dependencies['pkg-a'].source = 'file'
        expect(getLatestVersion('pkg-a')).toBeUndefined()
        expect(hasUpdate('pkg-a')).toBeUndefined()
    })
})

describe('忽略规则判定', () => {
    it('忽略最高候选后其下候选一并忽略,但"已忽略版本"标记仍指向它', () => {
        setupVersions()
        const policy = { updateIgnored: { 'pkg-a': { version: '2.0.0' } } }
        expect(getLatestVersion('pkg-a', policy)).toBeUndefined()
        expect(getIgnoredUpdateVersion('pkg-a', policy)).toBe('2.0.0')
        expect(isUpdateIgnored('pkg-a', policy)).toBe(true)
    })

    it('count 向上连坐:忽略次新 1.1.0 且 count=2 时更高的 2.0.0 也被忽略', () => {
        setupVersions()
        expect(getLatestVersion('pkg-a', { updateIgnored: { 'pkg-a': { version: '1.1.0', count: 2 } } })).toBeUndefined()
        expect(getLatestVersion('pkg-a', { updateIgnored: { 'pkg-a': { version: '1.1.0', count: 1 } } })).toBe('2.0.0')
    })

    it('until 已过期的规则不再忽略', () => {
        setupVersions()
        const policy = { updateIgnored: { 'pkg-a': { version: '2.0.0', until: Date.now() - 1000 } } }
        expect(getLatestVersion('pkg-a', policy)).toBe('2.0.0')
        expect(isUpdateIgnored('pkg-a', policy)).toBe(false)
    })

    it('禁检包短路:无候选、不标已忽略', () => {
        setupVersions()
        const policy = { updateIgnoredPackages: 'pkg-a' }
        expect(getLatestVersion('pkg-a', policy)).toBeUndefined()
        expect(getIgnoredUpdateVersion('pkg-a', policy)).toBeUndefined()
        expect(hasUpdate('pkg-a', policy)).toBeUndefined()
    })
})

describe('createUpdateIgnoreRule', () => {
    it('默认目标是当前最新候选,count 归一为 1', () => {
        setupVersions()
        const rule = createUpdateIgnoreRule('pkg-a')
        expect(rule).toMatchObject({ version: '2.0.0', count: 1 })
        expect(rule?.until).toBeUndefined()
    })

    it('options 覆盖时长与次数', () => {
        setupVersions()
        const before = Date.now()
        const rule = createUpdateIgnoreRule('pkg-a', undefined, { duration: 3600_000, count: 3 })
        expect(rule?.count).toBe(3)
        expect(rule?.until!).toBeGreaterThanOrEqual(before + 3600_000)
    })

    it('无升级候选时返回 undefined', () => {
        setupVersions('2.0.0')
        expect(createUpdateIgnoreRule('pkg-a')).toBeUndefined()
    })
})
