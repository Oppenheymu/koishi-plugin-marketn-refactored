<template>
  <div class="market-filter-group">
    <div class="market-filter-title">
      <h2 class="text">{{ t('type.sort') }}</h2>
    </div>
    <template v-for="(item, key) in comparators" :key="key">
      <div
        v-if="!item.hidden"
        class="market-filter-item"
        :class="{ active: activeSort[0] === key }"
        @click="toggleSort('sort:' + key, $event)">
        <span class="icon"><market-icon :name="item.icon"></market-icon></span>
        <span class="text">{{ t(`sort.${key}`) }}</span>
        <span class="spacer"></span>
        <span class="order"><market-icon :name="activeSort[1]"></market-icon></span>
      </div>
    </template>
  </div>
  <div class="market-filter-group">
    <div class="market-filter-title">
      <h2 class="text">{{ t('type.filter') }}</h2>
    </div>
    <template v-for="(item, key) in badges" :key="key">
      <div
        v-if="!item.hidden?.(config ?? {}, 'filter')"
        class="market-filter-item"
        :class="{ [key]: true, active: words.includes(item.query), disabled: words.includes(item.negate) }"
        @click="toggleQuery(item, $event)">
        <span class="icon"><market-icon :name="item.icon || key"></market-icon></span>
        <span class="text">{{ t(`badge.${key}`) }}</span>
        <span class="spacer"></span>
        <span class="count" v-if="data">
          {{ badgeCounts[key] ?? 0 }}
        </span>
      </div>
    </template>
  </div>
  <details class="market-filter-group market-filter-advanced" :open="advancedOpen || hasDateFilters" @toggle="onAdvancedToggle">
    <summary class="market-filter-title market-advanced-summary">
      <h2 class="text">{{ t('type.advanced') }}</h2>
      <span v-if="hasDateFilters" class="market-advanced-count">{{ activeDateFilterCount }}</span>
    </summary>
    <div class="market-date-filter">
      <label class="market-date-row">
        <span>{{ t('advanced.createdWithin') }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="4"
          :placeholder="t('advanced.daysPlaceholder')"
          :value="relativeDateFilters.createdWithin"
          @input="updateRelativeDateFilterFromEvent('createdWithin', $event)"
          @keydown.enter.prevent="commitRelativeDateFilterFromEvent('createdWithin', $event)"
          @blur="commitRelativeDateFilterFromEvent('createdWithin', $event)"
        >
      </label>
      <label class="market-date-row">
        <span>{{ t('advanced.updatedWithin') }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="4"
          :placeholder="t('advanced.daysPlaceholder')"
          :value="relativeDateFilters.updatedWithin"
          @input="updateRelativeDateFilterFromEvent('updatedWithin', $event)"
          @keydown.enter.prevent="commitRelativeDateFilterFromEvent('updatedWithin', $event)"
          @blur="commitRelativeDateFilterFromEvent('updatedWithin', $event)"
        >
      </label>
      <label class="market-date-row">
        <span>{{ t('advanced.createdAfter') }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="10"
          pattern="\d{4}-\d{2}-\d{2}"
          :placeholder="t('advanced.datePlaceholder')"
          :value="dateDrafts.createdAfter"
          @input="updateDateFilterFromEvent('createdAfter', $event)"
          @keydown.enter.prevent="commitDateFilterFromEvent('createdAfter', $event)"
          @blur="commitDateFilterFromEvent('createdAfter', $event)"
        >
      </label>
      <label class="market-date-row">
        <span>{{ t('advanced.createdBefore') }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="10"
          pattern="\d{4}-\d{2}-\d{2}"
          :placeholder="t('advanced.datePlaceholder')"
          :value="dateDrafts.createdBefore"
          @input="updateDateFilterFromEvent('createdBefore', $event)"
          @keydown.enter.prevent="commitDateFilterFromEvent('createdBefore', $event)"
          @blur="commitDateFilterFromEvent('createdBefore', $event)"
        >
      </label>
      <label class="market-date-row">
        <span>{{ t('advanced.updatedAfter') }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="10"
          pattern="\d{4}-\d{2}-\d{2}"
          :placeholder="t('advanced.datePlaceholder')"
          :value="dateDrafts.updatedAfter"
          @input="updateDateFilterFromEvent('updatedAfter', $event)"
          @keydown.enter.prevent="commitDateFilterFromEvent('updatedAfter', $event)"
          @blur="commitDateFilterFromEvent('updatedAfter', $event)"
        >
      </label>
      <label class="market-date-row">
        <span>{{ t('advanced.updatedBefore') }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="10"
          pattern="\d{4}-\d{2}-\d{2}"
          :placeholder="t('advanced.datePlaceholder')"
          :value="dateDrafts.updatedBefore"
          @input="updateDateFilterFromEvent('updatedBefore', $event)"
          @keydown.enter.prevent="commitDateFilterFromEvent('updatedBefore', $event)"
          @blur="commitDateFilterFromEvent('updatedBefore', $event)"
        >
      </label>
      <button v-if="hasDateFilters" class="market-date-clear" type="button" @click="clearDateFilters">
        {{ t('advanced.clearDates') }}
      </button>
    </div>
  </details>
  <div class="market-filter-group">
    <div class="market-filter-title">
      <h2 class="text">{{ t('type.category') }}</h2>
    </div>
    <div
      v-for="key in categories" :key="key" class="market-filter-item"
      :class="{ active: words.includes('category:' + key) }"
      @click="toggleCategory('category:' + key, $event)">
      <span class="icon"><market-icon :name="'solid:' + key"></market-icon></span>
      <span class="text">{{ t(`category.${key}`) }}</span>
      <span class="spacer"></span>
      <span class="count" v-if="data">
        {{ categoryCounts[key] ?? 0 }}
      </span>
    </div>
  </div>
</template>

<script lang="ts" setup>

import { computed, inject, ref, watch } from 'vue'
import { Badge, badges, kConfig, comparators, categories, isBundleSearchObject, resolveCategory, useMarketI18n } from '../utils'
import { SearchObject } from '@koishijs/registry'
import MarketIcon from '../icons'

const props = defineProps<{
  modelValue: string[]
  data?: SearchObject[]
}>()

const emit = defineEmits(['update:modelValue'])

const { t } = useMarketI18n()

const config = inject(kConfig, {})

const words = ref<string[]>([''])
const advancedOpen = ref(false)
const supportedSorts = ['default', 'recommend', 'download', 'created', 'updated'] as const
const dateDrafts = ref<Record<DateFilterKey, string>>({
  createdAfter: '',
  createdBefore: '',
  updatedAfter: '',
  updatedBefore: '',
})

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

const dateFilterDefs = {
  createdAfter: { prefix: 'created:', operator: '>=', legacy: '>' },
  createdBefore: { prefix: 'created:', operator: '<=', legacy: '<' },
  updatedAfter: { prefix: 'updated:', operator: '>=', legacy: '>' },
  updatedBefore: { prefix: 'updated:', operator: '<=', legacy: '<' },
} as const

type DateFilterKey = keyof typeof dateFilterDefs

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

const relativeDateFilterDefs = {
  createdWithin: { token: 'created:within:' },
  updatedWithin: { token: 'updated:within:' },
} as const

type RelativeDateFilterKey = keyof typeof relativeDateFilterDefs

watch(() => props.modelValue, (value) => {
  words.value = normalizeWords(value.slice())
  syncDateDrafts()
}, { immediate: true, deep: true })

const badgeCounts = computed(() => {
  const result: Record<string, number> = Object.fromEntries(Object.keys(badges).map(key => [key, 0]))
  if (!props.data) return result
  const newbornAfter = Date.now() - 7 * 86400000
  for (const item of props.data) {
    if (config.installed?.(item)) result.installed++
    if (item.verified) result.verified++
    if (item.insecure) result.insecure++
    if (item.manifest?.preview) result.preview++
    if (item.portable) result.portable++
    if (isBundleSearchObject(item)) result.bundle++
    if (Date.parse(item.createdAt) >= newbornAfter) result.newborn++
  }
  return result
})

const categoryCounts = computed(() => {
  const result: Record<string, number> = {}
  if (!props.data) return result
  for (const key of categories) result[key] = 0
  for (const item of props.data) {
    const category = resolveCategory(item.category)
    if (category in result) result[category]++
  }
  return result
})

function addWord(word: string) {
  emitWords([...words.value.slice(0, -1), word])
}

function toggleSort(word: string, event: MouseEvent) {
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

function toggleCategory(word: string, event: MouseEvent) {
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

function toggleQuery(item: Badge, event: MouseEvent) {
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

function onAdvancedToggle(event: Event) {
  advancedOpen.value = (event.target as HTMLDetailsElement).open
}

function emitWords(value: string[]) {
  words.value = normalizeWords(value)
  emit('update:modelValue', words.value)
}

function normalizeWords(value: string[]) {
  const tokens = value.filter(Boolean)
  return tokens.length ? [...tokens, ''] : ['']
}

function syncDateDrafts() {
  dateDrafts.value.createdAfter = readDateFilter('createdAfter')
  dateDrafts.value.createdBefore = readDateFilter('createdBefore')
  dateDrafts.value.updatedAfter = readDateFilter('updatedAfter')
  dateDrafts.value.updatedBefore = readDateFilter('updatedBefore')
}

</script>

<style lang="scss" scoped src="./filter.scss"></style>
