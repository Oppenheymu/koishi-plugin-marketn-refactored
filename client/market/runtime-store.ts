import { markRaw, ref, shallowRef } from 'vue'
import type { MarketPayload } from '../../src/shared/types'

export type MarketRuntimeSnapshot = MarketPayload & {
  data: NonNullable<MarketPayload['data']>
}

export const marketRuntimeStore = {
  snapshot: shallowRef<MarketRuntimeSnapshot>(),
  loading: ref(false),
  error: ref<unknown>(),
  lookupData: shallowRef<MarketRuntimeSnapshot['data']>({}),
  lookupServices: shallowRef<Record<string, string[]>>({}),
}

export function applyRuntimeSnapshot(value: MarketPayload) {
  const current = marketRuntimeStore.snapshot.value
  if (current?.dataVersion != null && value.dataVersion != null && value.dataVersion < current.dataVersion) {
    return current
  }
  const snapshot = markRaw({ ...value, data: markRaw(value.data ?? {}) }) as MarketRuntimeSnapshot
  marketRuntimeStore.snapshot.value = snapshot
  marketRuntimeStore.error.value = undefined
  return snapshot
}

export function applyRuntimePatch(value: Partial<MarketPayload>) {
  const current = marketRuntimeStore.snapshot.value
  if (!current || !value.data) return current
  if (current.dataVersion != null && value.dataVersion != null && value.dataVersion < current.dataVersion) {
    return current
  }
  return applyRuntimeSnapshot({
    ...current,
    ...value,
    data: {
      ...current.data,
      ...value.data,
    },
  })
}
