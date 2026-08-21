import { computed, ref, type Ref } from 'vue'

const dateFilterDefs = {
  createdAfter: { prefix: 'created:', operator: '>=', legacy: '>' },
  createdBefore: { prefix: 'created:', operator: '<=', legacy: '<' },
  updatedAfter: { prefix: 'updated:', operator: '>=', legacy: '>' },
  updatedBefore: { prefix: 'updated:', operator: '<=', legacy: '<' },
} as const

type DateFilterKey = keyof typeof dateFilterDefs

const relativeDateFilterDefs = {
  createdWithin: { token: 'created:within:' },
  updatedWithin: { token: 'updated:within:' },
} as const

type RelativeDateFilterKey = keyof typeof relativeDateFilterDefs

/** 高级搜索里的日期过滤子系统（created:/updated: 词法读写，自 useFilter 拆出）。 */
export function useDateFilter(words: Ref<string[]>, emitWords: (value: string[]) => void) {
  const dateDrafts = ref<Record<DateFilterKey, string>>({
    createdAfter: '',
    createdBefore: '',
    updatedAfter: '',
    updatedBefore: '',
  })

  function isDateToken(word: string, key: DateFilterKey) {
    const def = dateFilterDefs[key]
    return word.startsWith(def.prefix + def.operator)
      || word.startsWith(def.prefix + def.legacy)
  }

  function isRelativeDateToken(word: string, key: RelativeDateFilterKey) {
    const def = relativeDateFilterDefs[key]
    return word.startsWith(def.token)
  }

  function readDateFilter(key: DateFilterKey) {
    const def = dateFilterDefs[key]
    const word = words.value?.find(word => isDateToken(word, key))
    if (!word) return ''
    if (word.startsWith(def.prefix + def.operator)) {
      return normalizeDateValue(word.slice(def.prefix.length + def.operator.length))
    }
    return normalizeDateValue(word.slice(def.prefix.length + def.legacy.length))
  }

  function normalizeDateValue(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 8)
    if (digits.length <= 4) return digits
    if (digits.length <= 6) return digits.slice(0, 4) + '-' + digits.slice(4)
    return digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6)
  }

  function isCompleteDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const timestamp = Date.parse(value + 'T00:00:00.000Z')
    if (!Number.isFinite(timestamp)) return false
    return new Date(timestamp).toISOString().slice(0, 10) === value
  }

  function updateDateFilter(key: DateFilterKey, value: string, force = false) {
    const normalized = normalizeDateValue(value)
    if (!normalized) {
      clearDateFilter(key)
      return
    }
    if (!force && !isCompleteDate(normalized)) return
    const next = words.value.filter(word => !isDateToken(word, key))
    const def = dateFilterDefs[key]
    next.push(def.prefix + def.operator + normalized)
    emitWords(next)
  }

  function readRelativeDateFilter(key: RelativeDateFilterKey) {
    const def = relativeDateFilterDefs[key]
    const word = words.value?.find(word => isRelativeDateToken(word, key))
    if (!word) return ''
    return normalizeDays(word.slice(def.token.length))
  }

  function normalizeDays(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 4)
    if (!digits) return ''
    return String(Math.max(0, Math.min(9999, Number(digits))))
  }

  function updateRelativeDateFilter(key: RelativeDateFilterKey, value: string) {
    const days = normalizeDays(value)
    if (!days) {
      clearRelativeDateFilter(key)
      return
    }
    const next = words.value.filter(word => !isRelativeDateToken(word, key))
    const def = relativeDateFilterDefs[key]
    next.push(def.token + days)
    emitWords(next)
  }

  function updateRelativeDateFilterFromEvent(key: RelativeDateFilterKey, event: Event) {
    const input = event.target as HTMLInputElement
    const normalized = normalizeDays(input.value)
    input.value = normalized
    updateRelativeDateFilter(key, normalized)
  }

  function updateDateFilterFromEvent(key: DateFilterKey, event: Event) {
    const input = event.target as HTMLInputElement
    const normalized = normalizeDateValue(input.value)
    input.value = normalized
    dateDrafts.value[key] = normalized
    updateDateFilter(key, normalized)
  }

  function commitDateFilterFromEvent(key: DateFilterKey, event: Event) {
    const input = event.target as HTMLInputElement
    const normalized = normalizeDateValue(input.value)
    input.value = normalized
    dateDrafts.value[key] = normalized
    updateDateFilter(key, normalized, true)
  }

  function commitRelativeDateFilterFromEvent(key: RelativeDateFilterKey, event: Event) {
    const input = event.target as HTMLInputElement
    const normalized = normalizeDays(input.value)
    input.value = normalized
    updateRelativeDateFilter(key, normalized)
  }

  function clearDateFilter(key: DateFilterKey) {
    const next = words.value.filter(word => !isDateToken(word, key))
    emitWords(next)
  }

  function clearRelativeDateFilter(key: RelativeDateFilterKey) {
    const next = words.value.filter(word => !isRelativeDateToken(word, key))
    emitWords(next)
  }

  function clearDateFilters() {
    dateDrafts.value = {
      createdAfter: '',
      createdBefore: '',
      updatedAfter: '',
      updatedBefore: '',
    }
    words.value = words.value.filter(word => {
      if (Object.keys(dateFilterDefs).some(key => isDateToken(word, key as DateFilterKey))) return false
      if (Object.keys(relativeDateFilterDefs).some(key => isRelativeDateToken(word, key as RelativeDateFilterKey))) return false
      return true
    })
    emitWords(words.value)
  }

  function syncDateDrafts() {
    dateDrafts.value.createdAfter = readDateFilter('createdAfter')
    dateDrafts.value.createdBefore = readDateFilter('createdBefore')
    dateDrafts.value.updatedAfter = readDateFilter('updatedAfter')
    dateDrafts.value.updatedBefore = readDateFilter('updatedBefore')
  }

  const dateFilters = computed<Record<DateFilterKey, string>>(() => ({
    createdAfter: readDateFilter('createdAfter'),
    createdBefore: readDateFilter('createdBefore'),
    updatedAfter: readDateFilter('updatedAfter'),
    updatedBefore: readDateFilter('updatedBefore'),
  }))

  const relativeDateFilters = computed<Record<RelativeDateFilterKey, string>>(() => ({
    createdWithin: readRelativeDateFilter('createdWithin'),
    updatedWithin: readRelativeDateFilter('updatedWithin'),
  }))

  const hasDateFilters = computed(() => [
    ...Object.values(dateFilters.value),
    ...Object.values(relativeDateFilters.value),
  ].some(Boolean))

  const activeDateFilterCount = computed(() => [
    ...Object.values(dateFilters.value),
    ...Object.values(relativeDateFilters.value),
  ].filter(Boolean).length)

  return {
    dateDrafts,
    dateFilters,
    relativeDateFilters,
    hasDateFilters,
    activeDateFilterCount,
    updateRelativeDateFilterFromEvent,
    commitRelativeDateFilterFromEvent,
    updateDateFilterFromEvent,
    commitDateFilterFromEvent,
    clearDateFilters,
    syncDateDrafts,
  }
}
