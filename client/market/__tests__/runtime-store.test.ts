import { afterEach, describe, expect, it } from 'vitest'
import type { MarketPayload } from '../../../src/shared/types'
import {
  applyRuntimePatch,
  applyRuntimeSnapshot,
  marketRuntimeStore,
} from '../runtime-store'

function snapshot(dataVersion: number, data: Record<string, unknown>, revision?: number) {
  return {
    dataVersion,
    revision,
    data,
    total: Object.keys(data).length,
    failed: 0,
    progress: 1,
  } as unknown as MarketPayload
}

function patch(dataVersion: number, data: Record<string, unknown>, revision?: number) {
  return { dataVersion, revision, data } as unknown as Partial<MarketPayload>
}

afterEach(() => {
  marketRuntimeStore.snapshot.value = undefined
  marketRuntimeStore.lookupData.value = {}
  marketRuntimeStore.lookupServices.value = {}
  marketRuntimeStore.loading.value = false
  marketRuntimeStore.error.value = undefined
})

describe('market runtime snapshot', () => {
  it('applies a complete snapshot and keeps nested data raw', () => {
    const value = applyRuntimeSnapshot(snapshot(2, { foo: { package: { name: 'foo' } } }))
    expect(value?.data.foo).toMatchObject({ package: { name: 'foo' } })
    expect(marketRuntimeStore.snapshot.value).toBe(value)
  })

  it('ignores an older snapshot', () => {
    const current = applyRuntimeSnapshot(snapshot(3, { current: {} }))
    expect(applyRuntimeSnapshot(snapshot(2, { old: {} }))).toBe(current)
    expect(marketRuntimeStore.snapshot.value?.data).toEqual({ current: {} })
  })
})

describe('market runtime patch', () => {
  it('merges patches without replacing existing data', () => {
    applyRuntimeSnapshot(snapshot(4, { first: {}, shared: { old: true } }))
    applyRuntimePatch(patch(4, { second: {}, shared: { new: true } }))
    expect(marketRuntimeStore.snapshot.value?.data).toEqual({
      first: {},
      second: {},
      shared: { new: true },
    })
  })

  it('ignores an older patch after a newer snapshot', () => {
    applyRuntimeSnapshot(snapshot(6, { current: {} }))
    applyRuntimePatch(patch(5, { old: {} }))
    expect(marketRuntimeStore.snapshot.value?.data).toEqual({ current: {} })
  })

  it('ignores a patch received before the first snapshot', () => {
    expect(applyRuntimePatch(patch(1, { early: {} }))).toBeUndefined()
    expect(marketRuntimeStore.snapshot.value).toBeUndefined()
  })

  it('rejects skipped revisions until a complete snapshot is loaded', () => {
    applyRuntimeSnapshot(snapshot(7, { base: {} }, 10))
    expect(applyRuntimePatch(patch(7, { skipped: {} }, 12))).toBeUndefined()
    expect(marketRuntimeStore.snapshot.value?.data).toEqual({ base: {} })
    applyRuntimePatch(patch(7, { next: {} }, 11))
    expect(marketRuntimeStore.snapshot.value?.data).toEqual({ base: {}, next: {} })
  })

  it('ignores duplicate revisions', () => {
    applyRuntimeSnapshot(snapshot(8, { base: {} }, 10))
    applyRuntimePatch(patch(8, { next: {} }, 11))
    applyRuntimePatch(patch(8, { stale: {} }, 11))
    expect(marketRuntimeStore.snapshot.value?.data).toEqual({ base: {}, next: {} })
  })
})
