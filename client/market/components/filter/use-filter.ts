import { computed, inject, ref, watch } from 'vue'
import type { SearchObject } from '@koishijs/registry'
import type { Badge } from '../../utils'
import { badges, categories, isBundleSearchObject, kConfig, resolveCategory, useMarketI18n } from '../../utils'
import { useDateFilter } from './use-date-filter'

export function useFilter(
  props: { modelValue: string[], data?: SearchObject[] },
  emit: (event: 'update:modelValue', value: string[]) => void,
) {
  const { t } = useMarketI18n()

  const config = inject(kConfig, {})

  const words = ref<string[]>([''])
  const advancedOpen = ref(false)
  const supportedSorts = ['default', 'recommend', 'download', 'created', 'updated'] as const

  const activeSort = computed<string[]>(() => {
    let word = words.value.find(w => w.startsWith('sort:'))
    if (!word) return ['default', 'desc']
    word = word.slice(5)
    if (word.endsWith('-desc')) {
      const key = word.slice(0, -5)
      return [supportedSorts.includes(key as typeof supportedSorts[number]) ? key : 'default', 'desc']
    } else if (word.endsWith('-asc')) {
      const key = word.slice(0, -4)
      return [supportedSorts.includes(key as typeof supportedSorts[number]) ? key : 'default', 'asc']
    } else {
      return [supportedSorts.includes(word as typeof supportedSorts[number]) ? word : 'default', 'desc']
    }
  })

  function emitWords(value: string[]) {
    words.value = normalizeWords(value)
    emit('update:modelValue', words.value)
  }

  const {
    dateDrafts,
    relativeDateFilters,
    hasDateFilters,
    activeDateFilterCount,
    updateRelativeDateFilterFromEvent,
    commitRelativeDateFilterFromEvent,
    updateDateFilterFromEvent,
    commitDateFilterFromEvent,
    clearDateFilters,
    syncDateDrafts,
  } = useDateFilter(words, emitWords)

  watch(() => props.modelValue, (value) => {
    words.value = normalizeWords(value.slice())
    syncDateDrafts()
  }, { immediate: true, deep: true })

  const badgeCounts = computed(() => {
    const result: Record<string, number> = Object.fromEntries(Object.keys(badges).map(key => [key, 0]))
    const data = props.data
    if (!data) return result
    const newbornAfter = Date.now() - 7 * 86400000
    for (const item of data) {
      if (config.installed?.(item)) result['installed']!++
      if (item.verified) result['verified']!++
      if (item.insecure) result['insecure']!++
      if (item.manifest?.preview) result['preview']!++
      if (item.portable) result['portable']!++
      if (isBundleSearchObject(item)) result['bundle']!++
      if (Date.parse(item.createdAt) >= newbornAfter) result['newborn']!++
    }
    return result
  })

  const categoryCounts = computed(() => {
    const result: Record<string, number> = {}
    const data = props.data
    if (!data) return result
    for (const key of categories) result[key] = 0
    for (const item of data) {
      const category = resolveCategory(item.category)
      if (category && category in result) result[category]!++
    }
    return result
  })

  function addWord(word: string) {
    emitWords([...words.value.slice(0, -1), word])
  }

  function toggleSort(word: string, _event: MouseEvent) {
    if (word === 'sort:recommend') {
      const index = words.value.findIndex(x => x.startsWith('sort:'))
      if (index === -1) addWord(word)
      else words.value[index] = word
      emitWords(words.value)
      return
    }
    const index = words.value.findIndex(x => x.startsWith('sort:'))
    if (index === -1) {
      if (word === 'sort:default') {
        addWord('sort:default-asc')
      } else {
        addWord(word)
      }
    } else if (words.value[index] === word || words.value[index] === word + '-desc') {
      words.value[index] = word + '-asc'
    } else if (words.value[index] === word + '-asc') {
      words.value[index] = word
    } else {
      words.value[index] = word
    }
    emitWords(words.value)
  }

  function toggleCategory(word: string, _event: MouseEvent) {
    const index = words.value.findIndex(x => x.startsWith('category:'))
    if (index === -1) {
      addWord(word)
    } else if (words.value[index] === word) {
      words.value.splice(index, 1)
    } else {
      words.value[index] = word
    }
    emitWords(words.value)
  }

  function toggleQuery(item: Badge, _event: MouseEvent) {
    const { query, negate } = item
    const index = words.value.findIndex(x => x === query || x === negate)
    if (index === -1) {
      addWord(query)
    } else if (words.value[index] === query) {
      words.value[index] = negate
    } else {
      words.value.splice(index, 1)
    }
    emitWords(words.value)
  }

  function onAdvancedToggle(event: Event) {
    advancedOpen.value = (event.target as HTMLDetailsElement).open
  }

  function normalizeWords(value: string[]) {
    const tokens = value.filter(Boolean)
    return tokens.length ? [...tokens, ''] : ['']
  }

  return {
    t,
    config,
    words,
    advancedOpen,
    dateDrafts,
    activeSort,
    hasDateFilters,
    activeDateFilterCount,
    relativeDateFilters,
    badgeCounts,
    categoryCounts,
    toggleSort,
    toggleCategory,
    toggleQuery,
    updateRelativeDateFilterFromEvent,
    commitRelativeDateFilterFromEvent,
    updateDateFilterFromEvent,
    commitDateFilterFromEvent,
    clearDateFilters,
    onAdvancedToggle,
  }
}
