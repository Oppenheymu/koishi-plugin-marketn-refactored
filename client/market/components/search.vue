<template>
  <div class="search-box">
    <div class="search-container">
      <span
        v-for="(word, index) in displayWords"
        :key="index" class="search-word"
        :class="{ invalid: !validateWord(word) }"
        @click="onClickWord(index)"
      >{{ word }}</span>
      <input
        :placeholder="t('search.placeholder')"
        v-model="lastWord"
        ref="input"
        @blur="onBlur"
        @keydown.escape="onEscape"
        @keydown.backspace="onBackspace"
        @keydown.enter.prevent="commitInput"
        @keydown.space.prevent="commitInput"/>
    </div>
    <div class="search-action" @click.stop="onClear">
      <market-icon class="search" name="search"></market-icon>
      <market-icon class="close" name="close"></market-icon>
    </div>
  </div>
</template>

<script lang="ts" setup>

import { computed, ref, watch } from 'vue'
import { useMarketI18n, validateWord } from '../utils'
import { useDebounceFn } from '@vueuse/core'
import MarketIcon from '../icons'

const props = defineProps<{
  modelValue: string[]
  placeholder?: string
}>()

const emit = defineEmits(['update:modelValue'])

const input = ref<HTMLInputElement>()
const words = ref<string[]>([''])
const draft = ref('')

watch(() => props.modelValue, (value) => {
  const current = normalizeWords([...getCommittedWords(), draft.value])
  if (draft.value && document.activeElement === input.value && sameWords(value, current)) return
  const next = normalizeWords(value)
  words.value = next
  draft.value = next[next.length - 1] || ''
}, { immediate: true, deep: true })

const update = useDebounceFn(() => {
  emit('update:modelValue', normalizeWords([...getCommittedWords(), draft.value]))
}, 120, { maxWait: 500 })

const committedWords = computed(() => getCommittedWords())
const displayWords = computed(() => committedWords.value)

const lastWord = computed({
  get: () => draft.value,
  set: (value) => {
    draft.value = value.toLowerCase()
    update()
  },
})

function onClickWord(index: number) {
  const tokens = committedWords.value.slice()
  tokens.splice(index, 1)
  words.value = normalizeWords([...tokens, draft.value])
  emit('update:modelValue', words.value)
  input.value?.focus()
}

function commitInput() {
  const last = draft.value.trim().toLowerCase()
  if (!last) return
  const tokens = committedWords.value.slice()
  if (!tokens.includes(last)) {
    tokens.push(last)
  }
  draft.value = ''
  words.value = normalizeWords(tokens)
  emit('update:modelValue', words.value)
}

function onBlur() {
  draft.value = draft.value.trim().toLowerCase()
}

function onEscape() {
  draft.value = ''
  words.value = normalizeWords(committedWords.value)
  emit('update:modelValue', words.value)
}

function onBackspace(event: KeyboardEvent) {
  if (draft.value === '' && committedWords.value.length) {
    event.preventDefault()
    const tokens = committedWords.value.slice(0, -1)
    words.value = normalizeWords(tokens)
    emit('update:modelValue', words.value)
  }
}

function onClear() {
  draft.value = ''
  words.value = ['']
  emit('update:modelValue', words.value)
}

function focus() {
  input.value?.focus()
}

function normalizeWords(value: string[]) {
  const tokens = value.filter(Boolean)
  return tokens.length ? [...tokens, ''] : ['']
}

function getCommittedWords() {
  return words.value.slice(0, -1).filter(Boolean)
}

function sameWords(a: string[], b: string[]) {
  const left = normalizeWords(a)
  const right = normalizeWords(b)
  return left.length === right.length && left.every((word, index) => word === right[index])
}

defineExpose({ focus })

const { t } = useMarketI18n()

</script>

<style lang="scss" scoped src="./search.scss"></style>
