<template>
  <details class="market-filter-group market-filter-advanced" :open="filter.advancedOpen || filter.hasDateFilters" @toggle="filter.onAdvancedToggle">
    <summary class="market-filter-title market-advanced-summary">
      <h2 class="text">{{ t('type.advanced') }}</h2>
      <span v-if="filter.hasDateFilters" class="market-advanced-count">{{ filter.activeDateFilterCount }}</span>
    </summary>
    <div class="market-date-filter">
      <filter-date-row :label="t('advanced.createdWithin')" :value="filter.relativeDateFilters.createdWithin" :maxlength="4" :placeholder="t('advanced.daysPlaceholder')"
        :on-input="(e) => filter.updateRelativeDateFilterFromEvent('createdWithin', e)" :on-commit="(e) => filter.commitRelativeDateFilterFromEvent('createdWithin', e)"></filter-date-row>
      <filter-date-row :label="t('advanced.updatedWithin')" :value="filter.relativeDateFilters.updatedWithin" :maxlength="4" :placeholder="t('advanced.daysPlaceholder')"
        :on-input="(e) => filter.updateRelativeDateFilterFromEvent('updatedWithin', e)" :on-commit="(e) => filter.commitRelativeDateFilterFromEvent('updatedWithin', e)"></filter-date-row>
      <filter-date-row :label="t('advanced.createdAfter')" :value="filter.dateDrafts.createdAfter" :maxlength="10" pattern="\d{4}-\d{2}-\d{2}" :placeholder="t('advanced.datePlaceholder')"
        :on-input="(e) => filter.updateDateFilterFromEvent('createdAfter', e)" :on-commit="(e) => filter.commitDateFilterFromEvent('createdAfter', e)"></filter-date-row>
      <filter-date-row :label="t('advanced.createdBefore')" :value="filter.dateDrafts.createdBefore" :maxlength="10" pattern="\d{4}-\d{2}-\d{2}" :placeholder="t('advanced.datePlaceholder')"
        :on-input="(e) => filter.updateDateFilterFromEvent('createdBefore', e)" :on-commit="(e) => filter.commitDateFilterFromEvent('createdBefore', e)"></filter-date-row>
      <filter-date-row :label="t('advanced.updatedAfter')" :value="filter.dateDrafts.updatedAfter" :maxlength="10" pattern="\d{4}-\d{2}-\d{2}" :placeholder="t('advanced.datePlaceholder')"
        :on-input="(e) => filter.updateDateFilterFromEvent('updatedAfter', e)" :on-commit="(e) => filter.commitDateFilterFromEvent('updatedAfter', e)"></filter-date-row>
      <filter-date-row :label="t('advanced.updatedBefore')" :value="filter.dateDrafts.updatedBefore" :maxlength="10" pattern="\d{4}-\d{2}-\d{2}" :placeholder="t('advanced.datePlaceholder')"
        :on-input="(e) => filter.updateDateFilterFromEvent('updatedBefore', e)" :on-commit="(e) => filter.commitDateFilterFromEvent('updatedBefore', e)"></filter-date-row>
      <button v-if="filter.hasDateFilters" class="market-date-clear" type="button" @click="filter.clearDateFilters">
        {{ t('advanced.clearDates') }}
      </button>
    </div>
  </details>
</template>

<script lang="ts" setup>
import { inject } from 'vue'
import { useMarketNextI18n } from '../../../i18n'
import { filterContextKey } from './filter-context'
import FilterDateRow from './filter-date-row.vue'

const { filter } = inject(filterContextKey)!
const { t } = useMarketNextI18n()
</script>
