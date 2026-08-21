<template>
  <label class="market-date-row">
    <span>{{ label }}</span>
    <input
      type="text"
      inputmode="numeric"
      :maxlength="maxlength"
      :pattern="pattern"
      :placeholder="placeholder"
      :value="value"
      @input="onInput($event)"
      @keydown.enter.prevent="onCommit($event)"
      @blur="onCommit($event)"
    >
  </label>
</template>

<script lang="ts" setup>
defineProps<{
  label: string
  value: string
  maxlength: number
  pattern?: string
  placeholder: string
  onInput: (event: Event) => void
  onCommit: (event: Event) => void
}>()
</script>
