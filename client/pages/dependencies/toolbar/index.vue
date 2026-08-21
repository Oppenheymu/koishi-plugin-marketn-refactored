<template>
  <div class="deps-toolbar">
    <div class="deps-toolbar-row">
      <el-select v-model="filter" size="small" class="deps-filter-select">
        <el-option
          v-for="option in filterOptions"
          :key="option.value"
          :value="option.value"
          :label="option.label + (option.count ? ' (' + option.count + ')' : '')"
        >
          <span class="deps-filter-option">
            <market-icon :name="option.icon"></market-icon>
            <span>{{ option.label }}</span>
            <span v-if="option.count" class="deps-filter-count">({{ option.count }})</span>
          </span>
        </el-option>
      </el-select>
      <button
        :class="['deps-filter', 'deps-prerelease-toggle', { active: prereleaseBlocked }]"
        @click="togglePrereleaseFilter"
      >
        <market-icon name="tag"></market-icon>
        <span>{{ t('dependencies.toolbar.blockPreview') }}</span>
      </button>
      <button
        class="deps-filter deps-layout-toggle"
        @click="toggleLayout"
        :title="depsLayout === 'grid' ? t('dependencies.toolbar.listView') : t('dependencies.toolbar.gridView')"
      >
        <svg v-if="depsLayout === 'grid'" viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="currentColor">
          <path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z"/>
        </svg>
        <svg v-else viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="currentColor">
          <path d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z"/>
        </svg>
        <span>{{ depsLayout === 'grid' ? t('dependencies.toolbar.listView') : t('dependencies.toolbar.gridView') }}</span>
      </button>
      <div class="deps-search">
        <el-input ref="searchInput" v-model="keyword" clearable :placeholder="t('dependencies.toolbar.searchPlaceholder')"></el-input>
      </div>
      <div class="deps-summary">
        <span v-if="summary.pending" class="primary">{{ t('dependencies.filters.pending') }} {{ summary.pending }}</span>
        <span v-if="summary.updatable" class="success">{{ t('dependencies.filters.updatable') }} {{ summary.updatable }}</span>
        <span v-if="summary.unconfigured" class="warning">{{ t('dependencies.filters.unconfigured') }} {{ summary.unconfigured }}</span>
        <span v-if="summary.errors" class="danger">{{ t('dependencies.filters.error') }} {{ summary.errors }}</span>
        <span v-if="summary.invalid" class="warning">{{ t('dependencies.filters.invalid') }} {{ summary.invalid }}</span>
        <span v-if="refreshing" class="loading">{{ t('dependencies.toolbar.loading') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">

import { ref } from 'vue'
import { useMarketNextI18n } from '../../../i18n'
import { MarketIcon } from '../../../market'
import type { FilterKey } from '../composables/useClassify'

const filter = defineModel<FilterKey>('filter', { required: true })
const keyword = defineModel<string>('keyword', { required: true })

defineProps<{
  filterOptions: {
    value: FilterKey
    label: string
    icon: string
    count: number
  }[]
  prereleaseBlocked: boolean
  depsLayout: 'grid' | 'list'
  summary: {
    total: number
    updatable: number
    bundle: number
    pending: number
    unconfigured: number
    ignored: number
    checkDisabled: number
    invalid: number
    errors: number
    local: number
    manual: number
  }
  refreshing: boolean
}>()

defineEmits<{
  (e: 'toggle-prerelease'): void
  (e: 'toggle-layout'): void
}>()

const { t } = useMarketNextI18n()

const searchInput = ref<{ focus?: () => void }>()

defineExpose({
  focus: () => searchInput.value?.focus?.(),
})

</script>

<style scoped src="./index.scss" lang="scss"></style>
